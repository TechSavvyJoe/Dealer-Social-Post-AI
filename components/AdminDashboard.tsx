import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dealer } from "../types";
import * as db from "../services/database";
import { Icon } from "./Icons";
import { logEvent, logError } from "../utils/telemetry";
import { motion } from "framer-motion";
import { Button } from "./ui/Button";
import { Skeleton } from "./ui/Skeleton";
import { RefreshCw, Pencil } from "lucide-react";
import { Leaderboard } from "./Leaderboard";
import { ApprovalQueue } from "./ApprovalQueue";
import { PostHistory } from "./PostHistory";
import { DealerSetupWizard } from "./DealerSetupWizard";
import { SystemHealthPanel } from "./SystemHealthPanel";
import { ConfirmationModal } from "./ConfirmationModal";
import { useAppStore } from "../stores/appStore";

const DealerCard: React.FC<{
  dealer: Dealer;
  onDelete: (id: string) => void;
  onEdit: (dealer: Dealer) => void;
  isDeleting: boolean;
}> = ({ dealer, onDelete, onEdit, isDeleting }) => {
  const isAdminDealer = dealer.code === "0000";

  return (
    <motion.div
      className="bg-white/5 border border-white/20 rounded-2xl p-4 sm:p-6"
      layout
    >
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-4">
          {dealer.logo ? (
            <img
              src={dealer.logo}
              alt={`${dealer.name} Logo`}
              className="w-16 h-16 object-contain rounded-lg bg-white/10 p-1"
            />
          ) : (
            <div className="w-16 h-16 bg-indigo-900 rounded-lg flex items-center justify-center">
              <Icon
                type="building-office"
                className="w-8 h-8 text-indigo-400"
              />
            </div>
          )}
          <div>
            <h3 className="text-xl font-bold text-white">{dealer.name}</h3>
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <span>
                Code:{" "}
                <span className="font-mono text-indigo-400 font-semibold">
                  {dealer.code || "N/A"}
                </span>
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-xs">ID: {dealer.id}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onEdit(dealer)}
            title="Edit Dealer"
          >
            <Pencil className="w-5 h-5" />
          </Button>
          <Button
            variant="danger"
            size="icon"
            onClick={() => onDelete(dealer.id)}
            disabled={isDeleting || isAdminDealer}
            title={
              isAdminDealer ? "Cannot delete Admin Control" : "Delete Dealer"
            }
          >
            <Icon type="trash" className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

export const AdminDashboard: React.FC = () => {
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState({
    name: "",
    code: "",
    admin_code: "",
    logoUrl: "",
    logoFile: null as File | null,
  });
  const [showForm, setShowForm] = useState(false);
  const [editingDealer, setEditingDealer] = useState<Dealer | null>(null);
  // Dealer awaiting delete confirmation. Deleting a dealership is permanent and
  // irreversible, so it must go through a confirm step rather than fire on a
  // single click.
  const [dealerPendingDelete, setDealerPendingDelete] = useState<Dealer | null>(
    null
  );

  // --- DATA FETCHING ---
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["dealers"],
    queryFn: () => db.getDealers(),
  });

  // --- MUTATIONS ---
  const addMutation = useMutation({
    mutationFn: db.addDealerWithFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dealers"] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ dealerId, formData }: { dealerId: string; formData: FormData }) =>
      db.updateDealerWithFile(dealerId, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dealers"] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: db.deleteDealer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dealers"] });
    },
    onError: (err) => {
      // Was silent before — a failed delete left the dealer on screen with no
      // signal. Surface it (rendered below) and log for diagnostics.
      logError("admin.dealer.delete.failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    },
  });

  // --- HELPERS ---
  const resetForm = () => {
    setFormState({
      name: "",
      code: "",
      admin_code: "",
      logoUrl: "",
      logoFile: null,
    });
    setShowForm(false);
    setEditingDealer(null);
  };

  const handleEditDealer = (dealer: Dealer) => {
    setEditingDealer(dealer);
    setFormState({
      name: dealer.name,
      code: dealer.code || "",
      admin_code: (dealer as any).admin_code || "",
      logoUrl: "",
      logoFile: null,
    });
    setShowForm(true);
  };

  // --- HANDLERS ---
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    // Only allow 4 digits for code field (and don't allow editing code when updating)
    if (name === "code" && (value.length > 4 || !/^\d*$/.test(value))) {
      return;
    }
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFormState((prev) => ({
      ...prev,
      logoFile: file,
      logoUrl: file ? "" : prev.logoUrl,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.name.trim()) return;
    
    // For new dealers, code is required
    if (!editingDealer && !formState.code.trim()) return;
    if (!editingDealer && formState.code.length !== 4) {
      alert("Dealer code must be exactly 4 digits");
      return;
    }

    const formData = new FormData();
    formData.append("name", formState.name.trim());
    
    // Only include code for new dealers (code cannot be changed)
    if (!editingDealer) {
      formData.append("code", formState.code.trim());
    }

    // admin_code is editable any time. Empty string clears it (no dealer-admin
    // access until a new code is set).
    formData.append("admin_code", formState.admin_code.trim());

    // Prioritize file upload, fallback to URL
    if (formState.logoFile) {
      formData.append("logo", formState.logoFile);
    } else if (formState.logoUrl.trim()) {
      // Fetch URL and convert to Blob for PocketBase file upload
      try {
        const response = await fetch(formState.logoUrl.trim());
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.statusText}`);
        }
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) {
          throw new Error("URL does not point to a valid image");
        }
        // Extract filename from URL or use a default
        const urlParts = formState.logoUrl.trim().split("/");
        const filename = urlParts[urlParts.length - 1]?.split("?")[0] || "logo.png";
        const file = new File([blob], filename, { type: blob.type });
        formData.append("logo", file);
      } catch (err) {
        console.error("Failed to fetch logo from URL:", err);
        alert("Could not load image from URL. Please upload a file instead, or ensure the URL is accessible (some URLs may be blocked by CORS).");
        return;
      }
    }
    
    if (editingDealer) {
      updateMutation.mutate({ dealerId: editingDealer.id, formData });
    } else {
      addMutation.mutate(formData);
    }
  };

  const dealers = data ?? [];

  // First-time setup hint — show the wizard if the logged-in (admin) dealer
  // hasn't filled in their own brand voice + color yet. Once dismissed via
  // localStorage flag, hide forever. The wizard updates the dealer record
  // via the same /api/app/dealers PATCH endpoint the form uses.
  const sessionDealer = useAppStore((s) => s.currentDealer);
  const [setupDismissed, setSetupDismissed] = React.useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("dsp.setupDismissed") === "1";
    } catch {
      return false;
    }
  });
  const showSetup =
    !setupDismissed &&
    !!sessionDealer &&
    (!sessionDealer.brand_voice || !sessionDealer.brand_color);

  const dismissSetup = () => {
    setSetupDismissed(true);
    try {
      localStorage.setItem("dsp.setupDismissed", "1");
    } catch {
      /* ignore */
    }
  };

  const handleWizardSave = async (
    fields: Record<string, string | boolean>
  ) => {
    if (!sessionDealer) throw new Error("No active session");
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => {
      fd.append(k, typeof v === "boolean" ? (v ? "true" : "false") : v);
    });
    const updated = await db.updateDealerWithFile(sessionDealer.id, fd);
    queryClient.invalidateQueries({ queryKey: ["dealers"] });
    // Optimistically merge into the live session dealer so the new brand
    // color + voice take effect without a re-login.
    useAppStore.setState((s) => ({
      currentDealer: s.currentDealer
        ? { ...s.currentDealer, ...fields, ...updated }
        : s.currentDealer,
    }));
    return updated;
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-2 sm:p-4 space-y-6">
      {showSetup && sessionDealer && (
        <DealerSetupWizard
          dealer={sessionDealer}
          onSave={handleWizardSave}
          onDismiss={dismissSetup}
        />
      )}

      {/* System health — super admin's first-pane diagnostic */}
      <SystemHealthPanel />

      {/* Leaderboard at the top — it's the most-checked number on this screen */}
      <Leaderboard />

      {/* Approval queue — only renders when the dealer has approvals enabled OR there are pending items */}
      <ApprovalQueue />

      {/* Full searchable post history with CSV export */}
      <PostHistory />

      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <h2 className="text-3xl sm:text-4xl font-bold text-white">
          Admin Dashboard
        </h2>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw className="w-4 h-4" />}
            onClick={() => refetch()}
            disabled={isPending}
          >
            {isPending ? "Refreshing…" : "Refresh"}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (showForm) {
                resetForm();
              } else {
                setShowForm(true);
              }
            }}
            leftIcon={<Icon type="plus" className="w-4 h-4" />}
          >
            {showForm ? "Cancel" : "Add Dealer"}
          </Button>
        </div>
      </div>

      {/* Add/Edit Dealer Form */}
      {showForm && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-800 p-6 rounded-lg"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-semibold">
                {editingDealer ? `Edit: ${editingDealer.name}` : "New Dealer"}
              </h3>
              {editingDealer?.logo && (
                <img
                  src={editingDealer.logo}
                  alt="Current logo"
                  className="w-12 h-12 object-contain rounded bg-white/10 p-1"
                />
              )}
            </div>
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-slate-300"
              >
                Dealer Name *
              </label>
              <input
                id="name"
                name="name"
                type="text"
                value={formState.name}
                onChange={handleInputChange}
                required
                className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white"
              />
            </div>
            <div>
              <label
                htmlFor="code"
                className="block text-sm font-medium text-slate-300"
              >
                Dealer Code (4 digits) {!editingDealer && "*"}
                <span className="text-xs text-slate-400 ml-2">
                  {editingDealer ? "(Cannot be changed)" : "Used for login (e.g., 5555, 6666)"}
                </span>
              </label>
              <input
                id="code"
                name="code"
                type="text"
                value={formState.code}
                onChange={handleInputChange}
                required={!editingDealer}
                disabled={!!editingDealer}
                maxLength={4}
                pattern="\d{4}"
                placeholder="e.g., 5555"
                className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white font-mono text-lg tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            {/* Manager admin code — when set, the GSM can log in with this
                code and land on the per-dealership admin dashboard. Leave
                blank to disable manager access for this dealer. */}
            <div>
              <label
                htmlFor="admin_code"
                className="block text-sm font-medium text-slate-300"
              >
                Manager Admin Code (optional)
                <span className="text-xs text-slate-400 ml-2">
                  4–12 chars. Separate code for the GSM/GM to access this
                  dealership's settings.
                </span>
              </label>
              <input
                id="admin_code"
                name="admin_code"
                type="text"
                value={formState.admin_code}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    admin_code: e.target.value
                      .replace(/[^A-Za-z0-9]/g, "")
                      .slice(0, 12),
                  }))
                }
                maxLength={12}
                placeholder="e.g., GSM2024 — leave blank to disable"
                className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white font-mono text-lg tracking-wider"
              />
            </div>

            <div>
              <label
                htmlFor="logoUrl"
                className="block text-sm font-medium text-slate-300"
              >
                Logo URL
              </label>
              <input
                id="logoUrl"
                name="logoUrl"
                type="text"
                value={formState.logoUrl}
                onChange={handleInputChange}
                disabled={!!formState.logoFile}
                className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white disabled:opacity-50"
              />
            </div>
            <div className="text-center text-slate-400 text-sm">OR</div>
            <div>
              <label
                htmlFor="logoFile"
                className="block text-sm font-medium text-slate-300"
              >
                Upload Logo {editingDealer && "(replaces current)"}
              </label>
              <input
                id="logoFile"
                name="logoFile"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="mt-1 block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={resetForm}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={addMutation.isPending || updateMutation.isPending}
              >
                {(addMutation.isPending || updateMutation.isPending) 
                  ? "Saving..." 
                  : editingDealer 
                    ? "Update Dealer" 
                    : "Save Dealer"}
              </Button>
            </div>
            {(addMutation.isError || updateMutation.isError) && (
              <p className="text-red-400">
                Error: {(addMutation.error || updateMutation.error)?.message}
              </p>
            )}
          </form>
        </motion.div>
      )}

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg">
          Error loading dealers: {String(error)}
        </div>
      )}
      {deleteMutation.isError && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg">
          Failed to delete dealer: {String(deleteMutation.error)}
        </div>
      )}
      {isPending ? (
        <div className="grid gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          {dealers.map((dealer) => (
            <DealerCard
              key={dealer.id}
              dealer={dealer}
              onDelete={(id) => {
                const target = dealers.find((d) => d.id === id);
                if (target) setDealerPendingDelete(target);
              }}
              onEdit={handleEditDealer}
              isDeleting={
                deleteMutation.isPending &&
                deleteMutation.variables === dealer.id
              }
            />
          ))}
          {dealers.length === 0 && !error && (
            <div className="text-center py-10 bg-white/5 rounded-2xl">
              <p>No dealerships found.</p>
            </div>
          )}
        </div>
      )}

      <ConfirmationModal
        isOpen={!!dealerPendingDelete}
        onClose={() => setDealerPendingDelete(null)}
        onConfirm={() => {
          if (dealerPendingDelete) deleteMutation.mutate(dealerPendingDelete.id);
          setDealerPendingDelete(null);
        }}
        itemName={dealerPendingDelete?.name ?? ""}
      />
    </div>
  );
};
