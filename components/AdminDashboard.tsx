import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dealer } from "../types";
import * as db from "../services/database";
import { logError } from "../utils/telemetry";
import { motion } from "framer-motion";
import { Button } from "./ui/Button";
import { Skeleton } from "./ui/Skeleton";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Eye,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserCog,
  UserRound,
  Users,
} from "lucide-react";
import { PersonEditModal } from "./PersonEditModal";
import { SystemHealthPanel } from "./SystemHealthPanel";
import { ConfirmationModal } from "./ConfirmationModal";
import { useAppStore } from "../stores/appStore";
import { useToast } from "./ui/Toast";
import { dataUrlToBlob, urlToDataUrl } from "../utils/imageUtils";
import {
  listPeoplePage,
  addPerson,
  acknowledgePinDistribution,
  updatePerson,
  type CredentialResult,
  type PeoplePage,
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
const PEOPLE_PAGE_SIZE = 50;

const fieldClassName =
  "mt-1 block w-full rounded-xl border border-surface-700 bg-surface-900/70 px-4 py-3 text-surface-50 placeholder:text-surface-500 transition-colors focus:border-primary-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";
const labelClassName = "block text-sm font-medium text-surface-300";

const isSystemDealer = (dealer: Dealer, sessionDealerId?: string) =>
  dealer.id === sessionDealerId || dealer.name?.toUpperCase() === "SYSTEM ADMIN";

export const AdminDashboard: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const sessionDealer = useAppStore((s) => s.currentDealer);
  const impersonatePerson = useAppStore((s) => s.impersonatePerson);

  const [tab, setTab] = useState<HubTab>("dealers");
  /** Empty means the approved all-dealership super-admin view. */
  const [selectedDealerId, setSelectedDealerId] = useState<string>("");
  const [showDealerForm, setShowDealerForm] = useState(false);
  const [editingDealer, setEditingDealer] = useState<Dealer | null>(null);
  const [dealerPendingDelete, setDealerPendingDelete] = useState<Dealer | null>(null);
  const [formState, setFormState] = useState({
    name: "",
    logoUrl: "",
    logoFile: null as File | null,
  });
  const [hoursWeek, setHoursWeek] = useState<WeekHours>(defaultWeekHours());

  const [personForm, setPersonForm] = useState({
    name: "",
  });
  const [peopleSearch, setPeopleSearch] = useState("");
  const [codesToShare, setCodesToShare] = useState(false);
  const [peopleCursor, setPeopleCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [oneTimeCredential, setOneTimeCredential] = useState<{
    person: Person;
    pin: string;
  } | null>(null);
  const [savingPerson, setSavingPerson] = useState(false);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);

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
  const {
    data: peoplePage,
    isPending: peopleLoading,
    error: peopleError,
    refetch: refetchPeople,
  } = useQuery({
    queryKey: [
      "people",
      peopleRole,
      selectedDealerId || "all",
      peopleSearch,
      codesToShare,
      peopleCursor,
    ],
    queryFn: () =>
      listPeoplePage({
        includeInactive: true,
        role: peopleRole,
        dealerId: selectedDealerId || undefined,
        q: peopleSearch,
        codesToShare,
        cursor: peopleCursor,
        limit: PEOPLE_PAGE_SIZE,
      }),
    enabled: tab === "admins" || tab === "users",
  });
  const people = peoplePage?.items || [];
  const peopleTotal = peoplePage?.total ?? people.length;
  const peopleRangeStart = people.length
    ? cursorHistory.length * PEOPLE_PAGE_SIZE + 1
    : 0;
  const peopleRangeEnd = people.length
    ? Math.min(peopleRangeStart + people.length - 1, peopleTotal)
    : 0;

  React.useEffect(() => {
    setPeopleCursor(undefined);
    setCursorHistory([]);
  }, [peopleRole, peopleSearch, codesToShare]);

  const dealerNameFor = (person: Person) =>
    person.dealerName ||
    storeDealers.find((dealer) => dealer.id === person.dealer)?.name ||
    "Unknown dealership";

  const selectDealer = (dealerId: string) => {
    setSelectedDealerId(dealerId);
    setPersonForm({ name: "" });
    setPeopleCursor(undefined);
    setCursorHistory([]);
    setOneTimeCredential(null);
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
    mutationFn: ({ dealerId, formData }: { dealerId: string; formData: FormData }) =>
      db.updateDealerWithFile(dealerId, formData),
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
        const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
        const filename = safeName.includes(".") ? safeName : `${safeName}.${extension}`;
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
    setSavingPerson(true);
    try {
      const created = await addPerson({
        name: personForm.name.trim(),
        role: peopleRole,
        dealer: selectedDealerId,
      });
      setOneTimeCredential({
        person: created.person,
        pin: created.pin,
      });
      toast.success(
        peopleRole === "manager"
          ? `Manager added to ${selectedDealer.name}. Set up their username and password.`
          : `Salesperson added to ${selectedDealer.name}.`,
      );
      setPersonForm({ name: "" });
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

  const handlePersonCommitted = React.useCallback(
    (updated: Person) => {
      // Credential mutations have already committed on the server. Reflect
      // them in every cached roster page immediately instead of leaving a
      // stale status badge visible while a refetch is in flight.
      queryClient.setQueriesData<PeoplePage>({ queryKey: ["people"] }, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((person) =>
                person.id === updated.id ? { ...person, ...updated } : person,
              ),
            }
          : current,
      );
      setEditingPerson((current) =>
        current?.id === updated.id ? { ...current, ...updated } : current,
      );
      setOneTimeCredential((current) => {
        if (current?.person.id !== updated.id) return current;
        if (!updated.pinNeedsDistribution) return null;
        // The PIN itself is intentionally one-time and remains only in this
        // handoff state. Keep its accompanying non-secret person summary fresh
        // after manager-login setup so reopening the editor cannot regress to
        // a stale "Not set" view.
        return {
          ...current,
          person: { ...current.person, ...updated },
        };
      });
    },
    [queryClient],
  );

  const handleCredentialIssued = React.useCallback((credential: CredentialResult) => {
    setOneTimeCredential({
      person: credential.person,
      pin: credential.pin,
    });
  }, []);

  const tabs: Array<{ key: HubTab; label: string; icon: typeof Building2 }> = [
    { key: "dealers", label: "Dealers", icon: Building2 },
    { key: "admins", label: "Admins", icon: Shield },
    { key: "users", label: "Users", icon: Users },
  ];

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentKey: HubTab,
  ) => {
    const currentIndex = tabs.findIndex(({ key }) => key === currentKey);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const tablist = event.currentTarget.closest('[role="tablist"]');
    const nextKey = tabs[nextIndex].key;
    setTab(nextKey);
    requestAnimationFrame(() => {
      tablist?.querySelector<HTMLButtonElement>(`#admin-tab-${nextKey}`)?.focus();
    });
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-0 sm:space-y-6 sm:p-2 lg:p-4">
      {/* Page identity first; diagnostics are a quiet strip below it. */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-content-tertiary">
            Platform
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-content-primary">
            System admin
          </h2>
          <p className="mt-1 max-w-xl text-sm text-content-secondary">
            Work across every dealership, or narrow the hub to one store. Every person
            remains clearly labeled and tenant-scoped.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<RefreshCw className="h-4 w-4" />}
          onClick={() => {
            void refetch();
            if (tab !== "dealers") void refetchPeople();
          }}
          disabled={isPending}
        >
          {isPending ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      <SystemHealthPanel />

      {/* Section toolbar: underline tabs + the tenant scope control. */}
      <div className="flex flex-col gap-3 border-b border-hairline lg:flex-row lg:items-end lg:justify-between">
        <div
          className="-mb-px flex w-full gap-1 overflow-x-auto sm:w-auto"
          role="tablist"
          aria-label="System admin sections"
        >
          {tabs.map(({ key, label, icon: TabIcon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`admin-tab-${key}`}
              aria-controls={`admin-panel-${key}`}
              aria-selected={tab === key}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
              onKeyDown={(event) => handleTabKeyDown(event, key)}
              className={cn(
                "flex min-w-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
                tab === key
                  ? "border-primary-500 text-content-primary"
                  : "border-transparent text-content-tertiary hover:text-content-secondary",
              )}
            >
              <TabIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex min-w-0 items-center gap-2 pb-2 lg:max-w-sm">
          <label
            htmlFor="selected-dealer"
            className="shrink-0 text-xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            Store
          </label>
          <select
            id="selected-dealer"
            value={selectedDealerId}
            onChange={(e) => selectDealer(e.target.value)}
            className="w-full min-w-0 rounded-md border border-hairline bg-surface-overlay px-3 py-2 text-sm text-content-primary"
          >
            <option value="">All dealerships</option>
            {storeDealers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {selectedDealer ? (
        <p className="-mt-3 text-xs text-content-tertiary sm:-mt-4">
          Showing people for{" "}
          <strong className="font-semibold text-content-secondary">
            {selectedDealer.name}
          </strong>
        </p>
      ) : null}

      {tab === "dealers" && (
        <div
          id="admin-panel-dealers"
          role="tabpanel"
          aria-labelledby="admin-tab-dealers"
          aria-busy={isPending}
          className="space-y-4"
        >
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" />}
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
                    {editingDealer ? `Edit: ${editingDealer.name}` : "New dealership"}
                  </h3>
                  <p className="mt-1 text-sm text-surface-400">
                    Access codes are assigned under Admins and Users — not on the store
                    record.
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
            <p className="text-sm text-rose-300" role="alert">
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
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? "Selected dealership" : "Select dealership"}: ${dealer.name}`}
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
                        aria-label={`Edit ${dealer.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="danger"
                        size="icon"
                        onClick={() => setDealerPendingDelete(dealer)}
                        disabled={deleteMutation.isPending}
                        title="Delete dealer"
                        aria-label={`Delete ${dealer.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
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
        </div>
      )}

      {(tab === "admins" || tab === "users") && (
        <div
          id={`admin-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`admin-tab-${tab}`}
          aria-busy={peopleLoading}
          className="space-y-4"
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-surface-900/55 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-500">
                Scope
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-surface-100">
                {selectedDealer?.name || "All dealerships"}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-surface-900/55 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-500">
                Showing
              </p>
              <p className="mt-1 text-sm font-semibold text-surface-100">
                {tab === "admins" ? "Managers" : "Salespeople"}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-surface-900/55 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-500">
                People
              </p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-surface-100">
                {people.length
                  ? `${peopleRangeStart}–${peopleRangeEnd} of ${peopleTotal}`
                  : `0 of ${peopleTotal}`}
              </p>
            </div>
          </div>

          <div className="sticky top-0 z-10 rounded-2xl border border-white/10 bg-surface-950/95 p-3 shadow-elevation-2 backdrop-blur-xl">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Search people</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={peopleSearch}
                  onChange={(event) =>
                    setPeopleSearch(event.target.value.slice(0, 120))
                  }
                  className="w-full rounded-xl border border-surface-700 bg-surface-900/80 py-2.5 pl-10 pr-3 text-sm text-surface-100 placeholder:text-surface-500 focus:border-primary-500 focus:outline-none"
                  placeholder={`Search ${tab === "admins" ? "managers" : "salespeople"}…`}
                />
              </label>
              <button
                type="button"
                aria-pressed={codesToShare}
                onClick={() => setCodesToShare((value) => !value)}
                className={cn(
                  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors",
                  codesToShare
                    ? "border-warning-400/30 bg-warning-500/15 text-warning-100"
                    : "border-surface-700 bg-surface-900/80 text-surface-300 hover:border-surface-600",
                )}
              >
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                Codes to share
              </button>
            </div>
          </div>

          {selectedDealer ? (
            <div className="rounded-2xl border border-white/10 bg-surface-900/60 p-4 sm:p-5">
              <h3 className="text-lg font-bold text-surface-50">
                {tab === "admins"
                  ? `Add manager · ${selectedDealer.name}`
                  : `Add salesperson · ${selectedDealer.name}`}
              </h3>
              <p className="mt-1 text-xs text-surface-400">
                {tab === "admins"
                  ? "A 4-digit fallback code is created first; then you’ll set the manager’s username and password."
                  : "The server creates a unique 4-digit code and shows it once."}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className={labelClassName} htmlFor="new-person-name">
                    Name
                  </label>
                  <input
                    id="new-person-name"
                    value={personForm.name}
                    onChange={(event) =>
                      setPersonForm({ name: event.target.value.slice(0, 120) })
                    }
                    className={fieldClassName}
                    placeholder={
                      tab === "admins" ? "e.g. Jordan Lee" : "e.g. Sarah Chen"
                    }
                  />
                </div>
                <Button
                  variant="primary"
                  disabled={savingPerson || !personForm.name.trim()}
                  className="min-h-12"
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
          ) : (
            <div className="rounded-xl border border-primary-500/20 bg-primary-500/[0.07] px-4 py-3 text-sm text-primary-100">
              You’re viewing every dealership. Select one store above when you need to
              add a person.
            </div>
          )}

          {oneTimeCredential ? (
            <div className="rounded-2xl border border-warning-400/25 bg-warning-500/[0.08] p-4">
              <p className="text-sm font-semibold text-warning-100">
                Share {oneTimeCredential.person.name}&apos;s code privately
              </p>
              <p className="mt-1 text-xs text-warning-100/70">
                This one-time response is not stored in the roster.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <code className="flex-1 rounded-xl border border-white/10 bg-surface-950/80 px-4 py-3 text-center text-xl tracking-[0.4em] text-surface-50">
                  {oneTimeCredential.pin}
                </code>
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(oneTimeCredential.pin)
                      .then(() => toast.success("Code copied."))
                      .catch(() => toast.error("Could not copy the code."));
                  }}
                >
                  Copy
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    void acknowledgePinDistribution(oneTimeCredential.person.id)
                      .then(() => {
                        setOneTimeCredential(null);
                        void refetchPeople();
                        toast.success("Code marked as shared.");
                      })
                      .catch((err) =>
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : "Could not update code status.",
                        ),
                      );
                  }}
                >
                  Mark as shared
                </Button>
                {oneTimeCredential.person.role === "manager" ? (
                  <Button
                    variant="outline"
                    onClick={() => setEditingPerson(oneTimeCredential.person)}
                  >
                    Set up manager login
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {peopleLoading && <Skeleton className="h-32 w-full rounded-2xl" />}
          {peopleError ? (
            <div
              className="rounded-2xl border border-error-500/25 bg-error-500/10 p-4 text-sm text-error-100"
              role="alert"
            >
              <p className="font-semibold">Roster unavailable</p>
              <p className="mt-1 text-error-200">
                {peopleError instanceof Error
                  ? peopleError.message
                  : "Try refreshing this view."}
              </p>
            </div>
          ) : null}

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
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-surface-400">
                    <span>{dealerNameFor(person)}</span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        person.pinNeedsDistribution
                          ? "bg-warning-500/10 text-warning-200 ring-1 ring-warning-500/20"
                          : person.hasPin
                            ? "bg-success-500/10 text-success-300 ring-1 ring-success-500/20"
                            : "bg-surface-800 text-surface-500 ring-1 ring-white/10",
                      )}
                    >
                      {person.pinNeedsDistribution
                        ? "Code to share"
                        : person.hasPin
                          ? "Code set"
                          : "No code"}
                    </span>
                    {person.role === "manager" ? (
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          person.hasManagerLogin
                            ? "bg-primary-500/10 text-primary-200 ring-1 ring-primary-400/25"
                            : "bg-surface-800 text-surface-400 ring-1 ring-white/10",
                        )}
                      >
                        {person.hasManagerLogin
                          ? `@${person.managerUsername}`
                          : "Manager login not set"}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<UserCog className="h-3.5 w-3.5" />}
                    onClick={() => setEditingPerson(person)}
                  >
                    Edit
                  </Button>
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
                {peopleSearch || codesToShare
                  ? "No people match these filters."
                  : tab === "admins"
                    ? `No managers yet for ${selectedDealer?.name || "these dealerships"}.`
                    : `No salespeople yet for ${selectedDealer?.name || "these dealerships"}.`}
              </p>
            )}
          </div>

          {(cursorHistory.length > 0 || peoplePage?.nextCursor) && (
            <div className="flex items-center justify-between border-t border-white/10 pt-3">
              <Button
                variant="outline"
                size="sm"
                disabled={cursorHistory.length === 0 || peopleLoading}
                leftIcon={<ChevronLeft className="h-4 w-4" />}
                onClick={() => {
                  const previous = cursorHistory[cursorHistory.length - 1];
                  setCursorHistory((history) => history.slice(0, -1));
                  setPeopleCursor(previous || undefined);
                }}
              >
                Previous
              </Button>
              <span className="text-xs text-surface-500">
                {PEOPLE_PAGE_SIZE} per page
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!peoplePage?.nextCursor || peopleLoading}
                rightIcon={<ChevronRight className="h-4 w-4" />}
                onClick={() => {
                  setCursorHistory((history) => [...history, peopleCursor || ""]);
                  setPeopleCursor(peoplePage?.nextCursor);
                }}
              >
                Next
              </Button>
            </div>
          )}
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

      <PersonEditModal
        isOpen={!!editingPerson}
        person={editingPerson}
        storeName={editingPerson ? dealerNameFor(editingPerson) : undefined}
        allowRoleEdit
        allowPinReveal
        allowManagerLoginEdit
        onClose={() => setEditingPerson(null)}
        onCommitted={handlePersonCommitted}
        onCredentialIssued={handleCredentialIssued}
        onSaved={(updated) => {
          handlePersonCommitted(updated);
          setEditingPerson(null);
          void refetchPeople();
          toast.success("Profile updated.");
        }}
      />
    </div>
  );
};
