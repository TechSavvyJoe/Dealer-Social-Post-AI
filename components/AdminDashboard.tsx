import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dealer } from "../types";
import * as db from "../services/database";
import { Icon } from "./Icons";
import { logError } from "../utils/telemetry";
import { motion } from "framer-motion";
import { Button } from "./ui/Button";
import { Skeleton } from "./ui/Skeleton";
import {
  Building2,
  Pencil,
  RefreshCw,
  Shield,
  UserRound,
  Users,
  Eye,
  Loader2,
} from "lucide-react";
import { SystemHealthPanel } from "./SystemHealthPanel";
import { ConfirmationModal } from "./ConfirmationModal";
import { useAppStore } from "../stores/appStore";
import { useToast } from "./ui/Toast";
import { dataUrlToBlob, urlToDataUrl } from "../utils/imageUtils";
import {
  listPeople,
  addPerson,
  updatePerson,
  type Person,
  type PersonRole,
} from "../services/salespeople";
import { HoursPicker } from "./HoursPicker";
import {
  defaultWeekHours,
  parseHoursString,
  serializeHours,
  type WeekHours,
} from "../utils/hoursFormat";
import { cn } from "../utils/classNames";

type HubTab = "dealers" | "admins" | "users";

const fieldClassName =
  "mt-1 block w-full rounded-xl border border-surface-700 bg-surface-900/70 px-4 py-3 text-surface-50 placeholder:text-surface-500 transition-colors focus:border-primary-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";
const labelClassName = "block text-sm font-medium text-surface-300";

const isSystemDealer = (dealer: Dealer, sessionDealerId?: string) =>
  dealer.id === sessionDealerId ||
  dealer.name?.toUpperCase() === "SYSTEM ADMIN";

export const AdminDashboard: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const sessionDealer = useAppStore((s) => s.currentDealer);
  const impersonatePerson = useAppStore((s) => s.impersonatePerson);

  const [tab, setTab] = useState<HubTab>("dealers");
  /** Active store context — required for Admins/Users; never "all dealers". */
  const [selectedDealerId, setSelectedDealerId] = useState<string>("");
  const [showDealerForm, setShowDealerForm] = useState(false);
  const [editingDealer, setEditingDealer] = useState<Dealer | null>(null);
  const [dealerPendingDelete, setDealerPendingDelete] = useState<Dealer | null>(
    null,
  );
  const [formState, setFormState] = useState({
    name: "",
    logoUrl: "",
    logoFile: null as File | null,
  });
  const [hoursWeek, setHoursWeek] = useState<WeekHours>(defaultWeekHours());

  const [personForm, setPersonForm] = useState({
    name: "",
    pin: "",
  });
  const [savingPerson, setSavingPerson] = useState(false);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["dealers"],
    queryFn: () => db.getDealers(),
  });

  const dealers = data ?? [];
  const storeDealers = useMemo(
    () => dealers.filter((d) => !isSystemDealer(d, sessionDealer?.id)),
    [dealers, sessionDealer?.id],
  );

  const selectedDealer = useMemo(
    () => storeDealers.find((d) => d.id === selectedDealerId) || null,
    [storeDealers, selectedDealerId],
  );

  // Drop selection if that store was deleted.
  React.useEffect(() => {
    if (
      selectedDealerId &&
      storeDealers.length > 0 &&
      !storeDealers.some((d) => d.id === selectedDealerId)
    ) {
      setSelectedDealerId("");
    }
  }, [selectedDealerId, storeDealers]);

  const peopleRole: PersonRole = tab === "admins" ? "manager" : "salesperson";
  const hasDealerContext = Boolean(selectedDealerId);

  const {
    data: people = [],
    isPending: peopleLoading,
    refetch: refetchPeople,
  } = useQuery({
    queryKey: ["people", peopleRole, selectedDealerId],
    queryFn: () =>
      listPeople({
        includeInactive: true,
        role: peopleRole,
        dealerId: selectedDealerId,
      }),
    enabled: hasDealerContext && (tab === "admins" || tab === "users"),
  });

  const selectDealer = (dealerId: string) => {
    setSelectedDealerId(dealerId);
    setPersonForm({ name: "", pin: "" });
  };

  const openPeopleTab = (dealerId: string, nextTab: "admins" | "users") => {
    selectDealer(dealerId);
    setTab(nextTab);
  };

  const resetDealerForm = () => {
    setFormState({ name: "", logoUrl: "", logoFile: null });
    setHoursWeek(defaultWeekHours());
    setShowDealerForm(false);
    setEditingDealer(null);
  };

  const addMutation = useMutation({
    mutationFn: db.addDealerWithFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dealers"] });
      toast.success("Dealer created.");
      resetDealerForm();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create dealer.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      dealerId,
      formData,
    }: {
      dealerId: string;
      formData: FormData;
    }) => db.updateDealerWithFile(dealerId, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dealers"] });
      toast.success("Dealer updated.");
      resetDealerForm();
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
      logError("admin.dealer.delete.failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      toast.error(err instanceof Error ? err.message : "Failed to delete dealer.");
    },
  });

  const handleEditDealer = (dealer: Dealer) => {
    setEditingDealer(dealer);
    setFormState({
      name: dealer.name,
      logoUrl: "",
      logoFile: null,
    });
    setHoursWeek(parseHoursString(dealer.hours) || defaultWeekHours());
    setShowDealerForm(true);
  };

  const handleDealerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.name.trim()) return;

    const formData = new FormData();
    formData.append("name", formState.name.trim());
    formData.append("hours", serializeHours(hoursWeek));

    if (formState.logoFile) {
      formData.append("logo", formState.logoFile);
    } else if (formState.logoUrl.trim()) {
      try {
        const normalizedUrl = formState.logoUrl.trim();
        const blob = await dataUrlToBlob(await urlToDataUrl(normalizedUrl));
        const pathname = new URL(normalizedUrl).pathname;
        const sourceName = pathname.split("/").pop() || "logo";
        const safeName = sourceName.replace(/[^A-Za-z0-9._-]/g, "_");
        const extension =
          blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
        const filename = safeName.includes(".")
          ? safeName
          : `${safeName}.${extension}`;
        formData.append("logo", new File([blob], filename, { type: blob.type }));
      } catch {
        toast.error(
          "Could not load that logo URL. Upload a file instead or use a public image.",
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

  const handleAddPerson = async () => {
    if (!selectedDealerId || !selectedDealer) {
      toast.error("Select a dealership first.");
      return;
    }
    if (!personForm.name.trim()) {
      toast.error("Name is required.");
      return;
    }
    if (personForm.pin && !/^\d{4}$/.test(personForm.pin)) {
      toast.error(
        "Access code must be exactly 4 digits (or leave blank to auto-generate).",
      );
      return;
    }
    setSavingPerson(true);
    try {
      await addPerson({
        name: personForm.name.trim(),
        pin: personForm.pin || undefined,
        role: peopleRole,
        dealer: selectedDealerId,
      });
      toast.success(
        peopleRole === "manager"
          ? `Manager added to ${selectedDealer.name}.`
          : `User added to ${selectedDealer.name}.`,
      );
      setPersonForm({ name: "", pin: "" });
      await refetchPeople();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add person.");
    } finally {
      setSavingPerson(false);
    }
  };

  const handleTogglePerson = async (person: Person) => {
    try {
      await updatePerson(person.id, { active: !person.active });
      await refetchPeople();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    }
  };

  const handleOpenAs = async (person: Person) => {
    if (!person.active) {
      toast.error("Reactivate this person before opening as them.");
      return;
    }
    setImpersonatingId(person.id);
    try {
      await impersonatePerson(person.id);
      toast.success(`Now viewing as ${person.name}.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not open as this person.",
      );
    } finally {
      setImpersonatingId(null);
    }
  };

  const tabs: Array<{ key: HubTab; label: string; icon: typeof Building2 }> = [
    { key: "dealers", label: "Dealers", icon: Building2 },
    { key: "admins", label: "Admins", icon: Shield },
    { key: "users", label: "Users", icon: Users },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-2 sm:p-4">
      <SystemHealthPanel />

      <div className="rounded-2xl border border-white/10 bg-surface-900/45 p-5 shadow-elevation-2 backdrop-blur-xl sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold text-surface-50 sm:text-4xl">
              System Admin
            </h2>
            <p className="mt-2 text-sm text-surface-400">
              Pick a dealership, then manage only that store&apos;s admins and
              users. Rosters never mix across dealers.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            onClick={() => {
              void refetch();
              if (hasDealerContext && tab !== "dealers") void refetchPeople();
            }}
            disabled={isPending}
          >
            {isPending ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            className="inline-flex w-full gap-1 rounded-xl border border-surface-800 bg-surface-950/60 p-1 sm:w-auto"
            role="tablist"
            aria-label="System admin sections"
          >
            {tabs.map(({ key, label, icon: TabIcon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors sm:flex-none",
                  tab === key
                    ? "bg-primary-500/30 text-primary-100"
                    : "text-surface-400 hover:text-surface-200",
                )}
              >
                <TabIcon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-md sm:items-end">
            <label
              htmlFor="selected-dealer"
              className="text-xs font-medium uppercase tracking-wide text-surface-400"
            >
              Working in dealership
            </label>
            <select
              id="selected-dealer"
              value={selectedDealerId}
              onChange={(e) => selectDealer(e.target.value)}
              className="w-full rounded-xl border border-surface-700 bg-surface-900/70 px-3 py-2.5 text-sm text-surface-100"
            >
              <option value="">Select a dealership…</option>
              {storeDealers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {selectedDealer ? (
              <p className="text-xs text-primary-300/90">
                Admins &amp; Users show only for{" "}
                <strong className="font-semibold text-primary-200">
                  {selectedDealer.name}
                </strong>
              </p>
            ) : (
              <p className="text-xs text-surface-500">
                Choose a store to view or edit its people.
              </p>
            )}
          </div>
        </div>
      </div>

      {tab === "dealers" && (
        <>
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Icon type="plus" className="h-4 w-4" />}
              onClick={() => {
                if (showDealerForm) resetDealerForm();
                else {
                  setEditingDealer(null);
                  setFormState({ name: "", logoUrl: "", logoFile: null });
                  setHoursWeek(defaultWeekHours());
                  setShowDealerForm(true);
                }
              }}
            >
              {showDealerForm ? "Cancel" : "Add Dealer"}
            </Button>
          </div>

          {showDealerForm && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-white/10 bg-surface-900/70 p-5 shadow-elevation-3 backdrop-blur-xl sm:p-6"
            >
              <form onSubmit={handleDealerSubmit} className="space-y-4">
                <div>
                  <h3 className="text-xl font-semibold text-surface-50">
                    {editingDealer
                      ? `Edit: ${editingDealer.name}`
                      : "New dealership"}
                  </h3>
                  <p className="mt-1 text-sm text-surface-400">
                    Access codes are assigned under Admins and Users — not on
                    the store record.
                  </p>
                </div>
                <div>
                  <label htmlFor="name" className={labelClassName}>
                    Dealer name *
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    value={formState.name}
                    onChange={(e) =>
                      setFormState((s) => ({ ...s, name: e.target.value }))
                    }
                    className={fieldClassName}
                    placeholder="e.g. Sunrise Auto Group"
                  />
                </div>
                <HoursPicker
                  value={hoursWeek}
                  onChange={setHoursWeek}
                  preview={serializeHours(hoursWeek)}
                />
                <div>
                  <label htmlFor="logoUrl" className={labelClassName}>
                    Logo URL
                  </label>
                  <input
                    id="logoUrl"
                    name="logoUrl"
                    type="url"
                    value={formState.logoUrl}
                    disabled={!!formState.logoFile}
                    onChange={(e) =>
                      setFormState((s) => ({ ...s, logoUrl: e.target.value }))
                    }
                    className={fieldClassName}
                    placeholder="https://example.com/logo.png"
                  />
                </div>
                <div>
                  <label htmlFor="logoFile" className={labelClassName}>
                    Upload logo {editingDealer ? "(replaces current)" : ""}
                  </label>
                  <input
                    id="logoFile"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        logoFile: e.target.files?.[0] || null,
                        logoUrl: e.target.files?.[0] ? "" : s.logoUrl,
                      }))
                    }
                    className="mt-1 block w-full rounded-xl border border-dashed border-surface-700 bg-surface-950/40 px-4 py-3 text-sm text-surface-400 file:mr-4 file:rounded-full file:border-0 file:bg-primary-600 file:px-4 file:py-2 file:font-semibold file:text-white"
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" variant="outline" onClick={resetDealerForm}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={addMutation.isPending || updateMutation.isPending}
                  >
                    {addMutation.isPending || updateMutation.isPending
                      ? "Saving…"
                      : editingDealer
                        ? "Update dealer"
                        : "Create dealer"}
                  </Button>
                </div>
              </form>
            </motion.div>
          )}

          {isPending && (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          )}
          {error && (
            <p className="text-sm text-rose-300">
              Failed to load dealerships. Try refresh.
            </p>
          )}

          <div className="space-y-3">
            {storeDealers.map((dealer) => {
              const isSelected = dealer.id === selectedDealerId;
              return (
                <motion.div
                  key={dealer.id}
                  layout
                  className={cn(
                    "rounded-2xl border p-4 shadow-elevation-1 backdrop-blur-xl sm:p-5",
                    isSelected
                      ? "border-primary-500/50 bg-primary-500/10 ring-1 ring-primary-400/30"
                      : "border-white/10 bg-surface-900/55",
                  )}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => selectDealer(dealer.id)}
                      className="flex min-w-0 items-center gap-4 text-left"
                    >
                      {dealer.logo ? (
                        <img
                          src={dealer.logo}
                          alt=""
                          className="h-14 w-14 rounded-xl border border-white/10 bg-surface-950/50 object-contain p-2"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-primary-500/20 bg-primary-500/10">
                          <Building2 className="h-7 w-7 text-primary-300" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-bold text-surface-50">
                          {dealer.name}
                          {isSelected && (
                            <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-primary-300">
                              selected
                            </span>
                          )}
                        </h3>
                        <p className="mt-0.5 text-xs text-surface-500">
                          {dealer.hours?.trim() || "Hours not set"}
                        </p>
                      </div>
                    </button>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openPeopleTab(dealer.id, "admins")}
                      >
                        Admins
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openPeopleTab(dealer.id, "users")}
                      >
                        Users
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleEditDealer(dealer)}
                        title="Edit dealer"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="danger"
                        size="icon"
                        onClick={() => setDealerPendingDelete(dealer)}
                        disabled={deleteMutation.isPending}
                        title="Delete dealer"
                      >
                        <Icon type="trash" className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
            {!isPending && storeDealers.length === 0 && (
              <p className="rounded-2xl border border-dashed border-surface-700 p-8 text-center text-sm text-surface-400">
                No dealerships yet. Add your first store to get started.
              </p>
            )}
          </div>
        </>
      )}

      {(tab === "admins" || tab === "users") && !hasDealerContext && (
        <div className="rounded-2xl border border-dashed border-surface-700 bg-surface-900/40 p-8 text-center">
          <Building2 className="mx-auto mb-3 h-8 w-8 text-surface-500" />
          <h3 className="text-lg font-semibold text-surface-100">
            Select a dealership first
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-surface-400">
            Admins and users are scoped to one store at a time. Choose a
            dealership above, or open{" "}
            <button
              type="button"
              className="font-semibold text-primary-300 underline-offset-2 hover:underline"
              onClick={() => setTab("dealers")}
            >
              Dealers
            </button>{" "}
            and use that store&apos;s Admins / Users buttons.
          </p>
        </div>
      )}

      {(tab === "admins" || tab === "users") && hasDealerContext && selectedDealer && (
        <div className="space-y-4">
          <div className="rounded-xl border border-primary-500/25 bg-primary-500/10 px-4 py-3 text-sm text-primary-100">
            Managing{" "}
            <strong className="font-semibold">{selectedDealer.name}</strong>
            {tab === "admins" ? " — managers only" : " — salespeople only"}
            . Switch dealership above to work in another store.
          </div>

          <div className="rounded-2xl border border-white/10 bg-surface-900/60 p-4 sm:p-5">
            <h3 className="text-lg font-bold text-surface-50">
              {tab === "admins"
                ? `Add manager · ${selectedDealer.name}`
                : `Add salesperson · ${selectedDealer.name}`}
            </h3>
            <p className="mt-1 text-xs text-surface-400">
              New people are created only for this dealership. Each gets a
              unique 4-digit sign-in code (leave blank to auto-generate).
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className={labelClassName}>Name</label>
                <input
                  value={personForm.name}
                  onChange={(e) =>
                    setPersonForm((p) => ({
                      ...p,
                      name: e.target.value.slice(0, 120),
                    }))
                  }
                  className={fieldClassName}
                  placeholder={
                    tab === "admins" ? "e.g. Jordan Lee" : "e.g. Sarah Chen"
                  }
                />
              </div>
              <div className="sm:w-28">
                <label className={labelClassName}>Code</label>
                <input
                  value={personForm.pin}
                  onChange={(e) =>
                    setPersonForm((p) => ({
                      ...p,
                      pin: e.target.value.replace(/\D/g, "").slice(0, 4),
                    }))
                  }
                  className={`${fieldClassName} font-mono tracking-widest`}
                  placeholder="auto"
                  inputMode="numeric"
                  maxLength={4}
                />
              </div>
              <Button
                variant="primary"
                disabled={savingPerson}
                leftIcon={
                  savingPerson ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserRound className="h-4 w-4" />
                  )
                }
                onClick={() => void handleAddPerson()}
              >
                Add
              </Button>
            </div>
          </div>

          {peopleLoading && <Skeleton className="h-32 w-full rounded-2xl" />}

          <div className="space-y-2">
            {people.map((person) => (
              <div
                key={person.id}
                className={cn(
                  "flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface-900/55 p-4 sm:flex-row sm:items-center sm:justify-between",
                  !person.active && "opacity-60",
                )}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-surface-50">
                    {person.name}
                    {!person.active && (
                      <span className="ml-2 text-xs font-medium text-surface-500">
                        inactive
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-surface-400">
                    {selectedDealer.name}
                    {person.pin ? (
                      <>
                        {" · "}
                        <span className="font-mono text-primary-300">
                          {person.pin}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!person.active || impersonatingId === person.id}
                    leftIcon={
                      impersonatingId === person.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )
                    }
                    onClick={() => void handleOpenAs(person)}
                  >
                    Open as
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTogglePerson(person)}
                  >
                    {person.active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </div>
            ))}
            {!peopleLoading && people.length === 0 && (
              <p className="rounded-2xl border border-dashed border-surface-700 p-8 text-center text-sm text-surface-400">
                {tab === "admins"
                  ? `No managers yet for ${selectedDealer.name}.`
                  : `No salespeople yet for ${selectedDealer.name}.`}
              </p>
            )}
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!dealerPendingDelete}
        onClose={() => setDealerPendingDelete(null)}
        onConfirm={() => {
          if (dealerPendingDelete) {
            deleteMutation.mutate(dealerPendingDelete.id);
            setDealerPendingDelete(null);
          }
        }}
        itemName={dealerPendingDelete?.name || "dealership"}
      />
    </div>
  );
};
