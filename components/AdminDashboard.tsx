import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dealer } from "../types";
import * as db from "../services/database";
import { Icon } from "./Icons";
import { logError } from "../utils/telemetry";
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
import { useToast } from "./ui/Toast";

const DEALER_CODE_LENGTH = 6;
const DEALER_CODE_PATTERN = /^\d{6}$/;
const ADMIN_DEALER_CODE = "000000";

const fieldClassName =
  "mt-1 block w-full rounded-xl border border-surface-700 bg-surface-900/70 px-4 py-3 text-surface-50 placeholder:text-surface-500 transition-colors focus:border-primary-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";
const labelClassName = "block text-sm font-medium text-surface-300";

const DealerCard: React.FC<{
  dealer: Dealer;
  onDelete: (id: string) => void;
  onEdit: (dealer: Dealer) => void;
  isDeleting: boolean;
}> = ({ dealer, onDelete, onEdit, isDeleting }) => {
  const isAdminDealer = dealer.code === ADMIN_DEALER_CODE;

  return (
    <motion.div
      className="rounded-2xl border border-white/10 bg-surface-900/55 p-4 shadow-elevation-1 backdrop-blur-xl transition-colors hover:border-primary-500/30 hover:bg-surface-900/75 sm:p-6"
      layout
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {dealer.logo ? (
            <img
              src={dealer.logo}
              alt={`${dealer.name} Logo`}
              className="h-16 w-16 rounded-xl border border-white/10 bg-surface-950/50 object-contain p-2"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-primary-500/20 bg-primary-500/10">
              <Icon
                type="building-office"
                className="h-8 w-8 text-primary-300"
              />
            </div>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-xl font-bold text-surface-50">
              {dealer.name}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-surface-400">
              <span>
                Code:{" "}
                <span className="font-mono font-semibold tracking-wider text-primary-300">
                  {dealer.code || "N/A"}
                </span>
              </span>
              <span className="hidden text-surface-700 sm:inline">|</span>
              <span className="text-xs text-surface-500">ID: {dealer.id}</span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
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
  const toast = useToast();
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
      toast.success("Dealer created.");
      resetForm();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create dealer.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ dealerId, formData }: { dealerId: string; formData: FormData }) =>
      db.updateDealerWithFile(dealerId, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dealers"] });
      toast.success("Dealer updated.");
      resetForm();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update dealer.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: db.deleteDealer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dealers"] });
      toast.success("Dealer deleted.");
    },
    onError: (err) => {
      // Was silent before — a failed delete left the dealer on screen with no
      // signal. Surface it (rendered below) and log for diagnostics.
      logError("admin.dealer.delete.failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      toast.error(err instanceof Error ? err.message : "Failed to delete dealer.");
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
    // Dealer login codes are fixed-width numeric codes.
    if (
      name === "code" &&
      (value.length > DEALER_CODE_LENGTH || !/^\d*$/.test(value))
    ) {
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
    
    if (!editingDealer && !DEALER_CODE_PATTERN.test(formState.code.trim())) {
      toast.error("Dealer code must be exactly 6 digits.");
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
        toast.error(
          "Could not load that logo URL. Upload a file instead or use a publicly accessible image."
        );
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
    <div className="mx-auto w-full max-w-5xl space-y-6 p-2 sm:p-4">
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

      <div className="rounded-2xl border border-white/10 bg-surface-900/45 p-5 shadow-elevation-2 backdrop-blur-xl sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold text-surface-50 sm:text-4xl">
              Admin dashboard
            </h2>
            <p className="mt-2 text-sm text-surface-400">
              Manage dealerships, login codes, approvals, and production health.
            </p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
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
      </div>

      {/* Add/Edit Dealer Form */}
      {showForm && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-white/10 bg-surface-900/70 p-5 shadow-elevation-3 backdrop-blur-xl sm:p-6"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-xl font-semibold text-surface-50">
                {editingDealer ? `Edit: ${editingDealer.name}` : "New Dealer"}
                </h3>
                <p className="mt-1 text-sm text-surface-400">
                  {editingDealer
                    ? "Update dealership details. Login codes cannot be changed after creation."
                    : "Create a dealership with a unique 6-digit login code."}
                </p>
              </div>
              {editingDealer?.logo && (
                <img
                  src={editingDealer.logo}
                  alt="Current logo"
                  className="h-12 w-12 rounded-xl border border-white/10 bg-surface-950/50 object-contain p-2"
                />
              )}
            </div>
            <div>
              <label
                htmlFor="name"
                className={labelClassName}
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
                className={fieldClassName}
                placeholder="e.g., Midtown Motors"
              />
            </div>
            <div>
              <label
                htmlFor="code"
                className={labelClassName}
              >
                Dealer Code (6 digits) {!editingDealer && "*"}
                <span className="ml-2 text-xs text-surface-400">
                  {editingDealer
                    ? "(Cannot be changed)"
                    : "Used for login (e.g., 123456)"}
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
                maxLength={DEALER_CODE_LENGTH}
                pattern="\d{6}"
                inputMode="numeric"
                placeholder="e.g., 123456"
                className={`${fieldClassName} font-mono text-lg tracking-[0.2em]`}
              />
            </div>

            {/* Manager admin code — when set, the GSM can log in with this
                code and land on the per-dealership admin dashboard. Leave
                blank to disable manager access for this dealer. */}
            <div>
              <label
                htmlFor="admin_code"
                className={labelClassName}
              >
                Manager Admin Code (optional)
                <span className="ml-2 text-xs text-surface-400">
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
                className={`${fieldClassName} font-mono text-lg tracking-wider`}
              />
            </div>

            <div>
              <label
                htmlFor="logoUrl"
                className={labelClassName}
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
                placeholder="https://example.com/logo.png"
                className={fieldClassName}
              />
            </div>
            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-surface-500">
              <span className="h-px flex-1 bg-white/10" />
              or
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <div>
              <label
                htmlFor="logoFile"
                className={labelClassName}
              >
                Upload Logo {editingDealer && "(replaces current)"}
              </label>
              <input
                id="logoFile"
                name="logoFile"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="mt-1 block w-full rounded-xl border border-dashed border-surface-700 bg-surface-950/40 px-4 py-3 text-sm text-surface-400 file:mr-4 file:rounded-full file:border-0 file:bg-primary-600 file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-primary-700"
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
              <p className="rounded-xl border border-error-500/30 bg-error-500/10 px-3 py-2 text-sm text-error-200">
                Error: {(addMutation.error || updateMutation.error)?.message}
              </p>
            )}
          </form>
        </motion.div>
      )}

      {error && (
        <div className="rounded-xl border border-error-700/50 bg-error-900/40 px-4 py-3 text-error-100">
          Error loading dealers: {String(error)}
        </div>
      )}
      {deleteMutation.isError && (
        <div className="rounded-xl border border-error-700/50 bg-error-900/40 px-4 py-3 text-error-100">
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
            <div className="rounded-2xl border border-white/10 bg-surface-900/45 py-10 text-center text-surface-400">
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
