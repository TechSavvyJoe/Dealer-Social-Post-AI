import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dealer } from "../types";
import * as db from "../services/database";
import { toUiMessage } from "../utils/errorMessages";
import { logError } from "../utils/telemetry";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { Skeleton } from "./ui/Skeleton";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  KeyRound,
  Loader2,
  Search,
  UserCog,
  UserRound,
} from "lucide-react";
import { PersonEditModal } from "./PersonEditModal";
import {
  ConnectionsPanel,
  SYSTEM_CONNECTIONS_QUERY_KEY,
} from "./admin/ConnectionsPanel";
import { SetupBoard } from "./admin/SetupBoard";
import { RefreshButton } from "./admin/RefreshButton";
import {
  fetchPeoplePage,
  PEOPLE_PAGE_SIZE,
  peopleQueryKey,
  type PeopleQueryParams,
} from "./admin/peopleQuery";
import { ConfirmationModal } from "./ConfirmationModal";
import { useAppStore } from "../stores/appStore";
import { useToast } from "./ui/Toast";
import { dataUrlToBlob, urlToDataUrl } from "../utils/imageUtils";
import {
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
import type { SettingsSectionId } from "../utils/dealerSetupStatus";

type HubTab = "dealers" | "admins" | "users" | "connections";

const fieldClassName =
  "mt-1.5 block min-h-11 w-full rounded-sm border border-strong bg-panel-raised px-3 text-base text-ink placeholder:text-ink-hint transition-colors duration-120 ease-out focus:border-brand-ink disabled:cursor-not-allowed disabled:opacity-50";
const labelClassName = "block text-sm font-medium text-ink-2";

const isSystemDealer = (dealer: Dealer, sessionDealerId?: string) =>
  dealer.id === sessionDealerId || dealer.name?.toUpperCase() === "SYSTEM ADMIN";

export const AdminDashboard: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const sessionDealer = useAppStore((s) => s.currentDealer);
  const impersonatePerson = useAppStore((s) => s.impersonatePerson);
  const setManagerEntry = useAppStore((s) => s.setManagerEntry);

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

  const { data, error, isPending, isFetching, refetch } = useQuery({
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
  const peopleParams: PeopleQueryParams = {
    role: peopleRole,
    dealerId: selectedDealerId,
    search: peopleSearch,
    codesToShare,
    cursor: peopleCursor,
  };
  const {
    data: peoplePage,
    isPending: peopleLoading,
    isFetching: peopleFetching,
    error: peopleError,
    refetch: refetchPeople,
  } = useQuery({
    queryKey: peopleQueryKey(peopleParams),
    queryFn: () => fetchPeoplePage(peopleParams),
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
    // The button that asked for this sits in the Dealers panel, which is now
    // hidden; focus goes to the tab that opened, as the arrow keys do.
    requestAnimationFrame(() => {
      document.getElementById(`admin-tab-${nextTab}`)?.focus();
    });
  };

  /**
   * Refresh, in each tab's toolbar ("Check again" on Connections): reloads
   * the store list and whatever the open tab shows.
   */
  const handleRefresh = () => {
    void refetch();
    if (tab === "admins" || tab === "users") void refetchPeople();
    if (tab === "connections") {
      void queryClient.invalidateQueries({ queryKey: [SYSTEM_CONNECTIONS_QUERY_KEY] });
    }
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
      toast.error(toUiMessage(err, "Failed to create dealer."));
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
      toast.error(toUiMessage(err, "Failed to update dealer."));
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
      toast.error(toUiMessage(err, "Failed to delete dealer."));
    },
  });

  const openNewDealerForm = () => {
    setEditingDealer(null);
    setFormState({ name: "", logoUrl: "", logoFile: null });
    setHoursWeek(defaultWeekHours());
    setShowDealerForm(true);
  };

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
      toast.error(toUiMessage(err, "Failed to add person."));
    } finally {
      setSavingPerson(false);
    }
  };

  const handleTogglePerson = async (person: Person) => {
    try {
      await updatePerson(person.id, { active: !person.active });
      await refetchPeople();
    } catch (err) {
      toast.error(toUiMessage(err, "Update failed."));
    }
  };

  /**
   * The one "Open as" path. A section is the setup board's deep link: it is
   * set before the session swap so the manager dashboard opens Settings on
   * it, and cleared again if the swap fails so it never steers a later,
   * unrelated "Open as". Rejects on failure; each caller shows the error.
   */
  const openAsPerson = async (person: Person, section?: SettingsSectionId) => {
    setImpersonatingId(person.id);
    setManagerEntry(section ? { section } : null);
    try {
      await impersonatePerson(person.id);
      toast.success(`Now viewing as ${person.name}.`);
    } catch (err) {
      setManagerEntry(null);
      throw err;
    } finally {
      setImpersonatingId(null);
    }
  };

  const handleOpenAs = async (person: Person) => {
    if (!person.active) {
      toast.error("Reactivate this person before opening as them.");
      return;
    }
    try {
      await openAsPerson(person);
    } catch (err) {
      toast.error(toUiMessage(err, "Could not open as this person."));
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

  const tabs: Array<{ key: HubTab; label: string }> = [
    { key: "dealers", label: "Dealers" },
    { key: "admins", label: "Admins" },
    { key: "users", label: "Users" },
    { key: "connections", label: "Connections" },
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

  const savingDealer = addMutation.isPending || updateMutation.isPending;

  // The store filter for the Admins and Users tabs. On Dealers, the setup
  // board's search replaces it.
  const storeSelect = (
    <div className="flex min-w-0 flex-1 items-center gap-3 sm:max-w-sm">
      <label htmlFor="selected-dealer" className="shrink-0 text-sm text-ink-2">
        Store
      </label>
      <select
        id="selected-dealer"
        value={selectedDealerId}
        onChange={(e) => selectDealer(e.target.value)}
        className="min-h-11 w-full min-w-0 rounded-sm border border-strong bg-panel-raised px-3 text-base text-ink transition-colors duration-120 ease-out focus:border-brand-ink"
      >
        <option value="">All dealerships</option>
        {storeDealers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </div>
  );

  const DEALER_FORM_ID = "admin-dealer-form";
  const dealerForm = (
    <form id={DEALER_FORM_ID} onSubmit={handleDealerSubmit} className="space-y-5">
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
          onChange={(e) => setFormState((s) => ({ ...s, name: e.target.value }))}
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
          onChange={(e) => setFormState((s) => ({ ...s, logoUrl: e.target.value }))}
          className={fieldClassName}
          placeholder="https://example.com/logo.png"
        />
      </div>
      <div>
        <label htmlFor="logoFile" className={labelClassName}>
          {editingDealer ? "Upload logo (replaces current)" : "Upload logo"}
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
          className="mt-1.5 block w-full rounded-sm border border-dashed border-strong bg-panel-raised px-3 py-2 text-sm text-ink-2 file:mr-4 file:min-h-9 file:rounded-sm file:border-0 file:bg-fill-hover file:px-4 file:text-sm file:font-semibold file:text-ink"
        />
      </div>
    </form>
  );

  const dealerFormFooter = (
    <>
      {editingDealer ? (
        <Button
          type="button"
          variant="danger"
          className="mr-auto"
          disabled={deleteMutation.isPending || savingDealer}
          onClick={() => {
            // The confirmation replaces the form rather than stacking a
            // second dialog over it.
            const target = editingDealer;
            resetDealerForm();
            setDealerPendingDelete(target);
          }}
        >
          Delete dealer
        </Button>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        disabled={savingDealer}
        onClick={resetDealerForm}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        form={DEALER_FORM_ID}
        variant="primary"
        disabled={savingDealer}
      >
        {savingDealer ? "Saving…" : editingDealer ? "Update dealer" : "Create dealer"}
      </Button>
    </>
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 pt-6 sm:px-6 sm:pt-10 lg:px-8">
      {/* One row: the page title and the four text tabs over one hairline. */}
      <div className="flex flex-col gap-2 border-b border-hairline sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-8">
        <h1 className="font-display text-[1.625rem] font-semibold leading-[1.875rem] tracking-[-0.01em] text-ink sm:mb-3.5 sm:text-4xl">
          System admin
        </h1>
        {/* A scroll box clips on both axes, so it carries 4 px of padding
            for the focus ring (2 px outline at 2 px offset) and cancels it
            with negative margins; -mb is 1 px more so the tabs still sit on
            the hairline. */}
        <div
          className="-mx-1 -mb-[5px] -mt-1 flex gap-6 overflow-x-auto p-1 sm:gap-7"
          role="tablist"
          aria-label="System admin sections"
        >
          {tabs.map(({ key, label }) => (
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
                "min-h-11 shrink-0 whitespace-nowrap border-b-2 text-sm font-semibold transition-colors duration-120 ease-out sm:text-[15px]",
                tab === key
                  ? "border-brand-fill text-ink"
                  : "border-transparent text-ink-2 hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 sm:mt-8">
        {tab === "connections" && (
          <div
            id="admin-panel-connections"
            role="tabpanel"
            aria-labelledby="admin-tab-connections"
          >
            {/* Undefined until the list loads, so no mapped store reads as missing. */}
            <ConnectionsPanel
              dealers={data ? storeDealers : undefined}
              onCheckAgain={handleRefresh}
            />
          </div>
        )}

        {/* Mounted on every tab (hidden when another is open) so unsaved setup
            notes, the open store and a save in flight survive a trip to the
            Admins or Users tab. */}
        <div
          id="admin-panel-dealers"
          role="tabpanel"
          aria-labelledby="admin-tab-dealers"
          aria-busy={isPending}
          hidden={tab !== "dealers"}
        >
          <SetupBoard
            dealers={storeDealers}
            loading={isPending}
            loadFailed={Boolean(error)}
            refreshing={isFetching}
            onRefresh={handleRefresh}
            onAddDealer={openNewDealerForm}
            onEditDealer={handleEditDealer}
            onDeleteDealer={setDealerPendingDelete}
            onOpenPeople={openPeopleTab}
            onOpenAs={openAsPerson}
            impersonating={impersonatingId !== null}
          />
        </div>

        {(tab === "admins" || tab === "users") && (
          <div
            id={`admin-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`admin-tab-${tab}`}
            aria-busy={peopleLoading}
            className="space-y-4"
          >
            <div className="flex items-center gap-3">
              {storeSelect}
              <RefreshButton
                busy={isFetching || peopleFetching}
                onClick={handleRefresh}
              />
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="font-display text-lg font-semibold text-ink">
                {tab === "admins" ? "Managers" : "Salespeople"} at{" "}
                {selectedDealer?.name || "every dealership"}
              </h2>
              <p className="text-sm tabular-nums text-ink-2">
                {people.length
                  ? `${peopleRangeStart}–${peopleRangeEnd} of ${peopleTotal}`
                  : `0 of ${peopleTotal}`}
              </p>
            </div>

            <div className="sticky top-0 z-10 bg-canvas py-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="relative min-w-0 flex-1">
                  <span className="sr-only">Search people</span>
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-hint"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={peopleSearch}
                    onChange={(event) =>
                      setPeopleSearch(event.target.value.slice(0, 120))
                    }
                    className="min-h-11 w-full rounded-sm border border-strong bg-panel-raised pl-10 pr-3 text-base text-ink placeholder:text-ink-hint transition-colors duration-120 ease-out focus:border-brand-ink"
                    placeholder={`Search ${tab === "admins" ? "managers" : "salespeople"}…`}
                  />
                </label>
                <Button
                  variant={codesToShare ? "secondary" : "ghost"}
                  aria-pressed={codesToShare}
                  leftIcon={<KeyRound />}
                  onClick={() => setCodesToShare((value) => !value)}
                >
                  Codes to share
                </Button>
              </div>
            </div>

            {selectedDealer ? (
              <div className="rounded-md border border-hairline bg-panel p-4 sm:p-5">
                <h3 className="font-display text-lg font-semibold text-ink">
                  {tab === "admins"
                    ? `Add a manager to ${selectedDealer.name}`
                    : `Add a salesperson to ${selectedDealer.name}`}
                </h3>
                <p className="mt-1 text-caption text-ink-2">
                  {tab === "admins"
                    ? "A 4-digit fallback code is created first; then you’ll set the manager’s username and password."
                    : "The server creates a unique 4-digit code and shows it once."}
                </p>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
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
                    leftIcon={
                      savingPerson ? (
                        <Loader2 className="animate-spin motion-reduce:animate-none" />
                      ) : (
                        <UserRound />
                      )
                    }
                    onClick={() => void handleAddPerson()}
                  >
                    Add
                  </Button>
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-hairline bg-panel px-4 py-3 text-sm text-ink-2">
                You’re viewing every dealership. Select one store above when you need to
                add a person.
              </p>
            )}

            {oneTimeCredential ? (
              <div className="rounded-md border border-warning-ink/30 bg-warning-fill p-4">
                <p className="text-sm font-semibold text-ink">
                  Share {oneTimeCredential.person.name}&apos;s code privately
                </p>
                <p className="mt-1 text-caption text-ink-2">
                  This one-time response is not stored in the roster.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <code className="flex-1 rounded-sm border border-hairline bg-panel-raised px-4 py-3 text-center font-display text-2xl tabular-nums tracking-[0.4em] text-ink">
                    {oneTimeCredential.pin}
                  </code>
                  <Button
                    variant="secondary"
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
                            toUiMessage(err, "Could not update code status."),
                          ),
                        );
                    }}
                  >
                    Mark as shared
                  </Button>
                  {oneTimeCredential.person.role === "manager" ? (
                    <Button
                      variant="secondary"
                      onClick={() => setEditingPerson(oneTimeCredential.person)}
                    >
                      Set up manager login
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {peopleLoading && <Skeleton className="h-32 w-full rounded-md" />}
            {peopleError ? (
              <div
                className="rounded-md bg-error-fill p-4 text-sm text-error-ink"
                role="alert"
              >
                <p className="font-semibold">Roster unavailable</p>
                <p className="mt-1">
                  {toUiMessage(peopleError, "Try refreshing this view.")}
                </p>
              </div>
            ) : null}

            {people.length > 0 ? (
              <ul className="divide-y divide-hairline rounded-md border border-hairline bg-panel">
                {people.map((person) => (
                  <li
                    key={person.id}
                    className={cn(
                      "flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between",
                      !person.active && "opacity-60",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-ink">
                        {person.name}
                        {!person.active && (
                          <span className="ml-2 text-caption font-medium text-ink-2">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">
                        <span>{dealerNameFor(person)}</span>
                        <Badge
                          variant={
                            person.pinNeedsDistribution
                              ? "warning"
                              : person.hasPin
                                ? "success"
                                : "neutral"
                          }
                        >
                          {person.pinNeedsDistribution
                            ? "Code to share"
                            : person.hasPin
                              ? "Code set"
                              : "No code"}
                        </Badge>
                        {person.role === "manager" ? (
                          <Badge variant="neutral">
                            {person.hasManagerLogin
                              ? `@${person.managerUsername}`
                              : "Manager login not set"}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        leftIcon={<UserCog />}
                        onClick={() => setEditingPerson(person)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={!person.active || impersonatingId === person.id}
                        leftIcon={
                          impersonatingId === person.id ? (
                            <Loader2 className="animate-spin motion-reduce:animate-none" />
                          ) : (
                            <Eye />
                          )
                        }
                        onClick={() => void handleOpenAs(person)}
                      >
                        Open as
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void handleTogglePerson(person)}
                      >
                        {person.active ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {!peopleLoading && people.length === 0 && (
              <p className="rounded-md border border-dashed border-strong p-8 text-center text-sm text-ink-2">
                {peopleSearch || codesToShare
                  ? "No people match these filters."
                  : tab === "admins"
                    ? `No managers yet for ${selectedDealer?.name || "these dealerships"}.`
                    : `No salespeople yet for ${selectedDealer?.name || "these dealerships"}.`}
              </p>
            )}

            {(cursorHistory.length > 0 || peoplePage?.nextCursor) && (
              <div className="flex items-center justify-between border-t border-hairline pt-3">
                <Button
                  variant="secondary"
                  disabled={cursorHistory.length === 0 || peopleLoading}
                  leftIcon={<ChevronLeft />}
                  onClick={() => {
                    const previous = cursorHistory[cursorHistory.length - 1];
                    setCursorHistory((history) => history.slice(0, -1));
                    setPeopleCursor(previous || undefined);
                  }}
                >
                  Previous
                </Button>
                <span className="text-caption text-ink-2">
                  {PEOPLE_PAGE_SIZE} per page
                </span>
                <Button
                  variant="secondary"
                  disabled={!peoplePage?.nextCursor || peopleLoading}
                  rightIcon={<ChevronRight />}
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
      </div>

      <Modal
        isOpen={showDealerForm}
        onClose={resetDealerForm}
        title={editingDealer ? `Edit ${editingDealer.name}` : "New dealership"}
        description="Access codes are assigned under Admins and Users, not on the store record."
        size="xl"
        disableClose={savingDealer}
        footer={dealerFormFooter}
      >
        {dealerForm}
      </Modal>

      <ConfirmationModal
        isOpen={!!dealerPendingDelete}
        onClose={() => setDealerPendingDelete(null)}
        onConfirm={() => {
          if (dealerPendingDelete) {
            deleteMutation.mutate(dealerPendingDelete.id);
            if (editingDealer?.id === dealerPendingDelete.id) resetDealerForm();
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
        allowManagerScopeEdit
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
