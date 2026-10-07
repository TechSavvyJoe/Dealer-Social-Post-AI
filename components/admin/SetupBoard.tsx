import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import type { Dealer } from "../../types";
import type { Person } from "../../services/salespeople";
import { useAppStore } from "../../stores/appStore";
import { cn } from "../../utils/classNames";
import { toUiMessage } from "../../utils/errorMessages";
import {
  dealerSetupStatus,
  displayUrl,
  SETTINGS_SECTION_LABELS,
  SETUP_STATE_LABELS,
  type DealerSetupStatus,
  type SettingsSectionId,
  type SetupRow,
} from "../../utils/dealerSetupStatus";
import { sampleLook } from "../dealer-settings/sampleProof";
import { SamplePhoto } from "../dealer-settings/SamplePhoto";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { Switch } from "../ui/Switch";
import {
  fetchPeoplePage,
  firstActiveManager,
  peopleQueryKey,
  storeManagersParams,
} from "./peopleQuery";
import { RefreshButton } from "./RefreshButton";
import {
  approvalCell,
  boardColumns,
  boardSummary,
  creativeFieldsReported,
  looksInWords,
  missingLine,
  setupNotesReported,
  type BoardColumn,
} from "./setupBoardModel";
import {
  SETUP_NOTES_MAX_LENGTH,
  useCreativeSystemSaves,
  useSetupNotes,
  type CreativeSystemSaves,
  type SetupNotes,
} from "./useSetupBoardSaves";

/**
 * What the creative system does, verified against services/creativeSystem.ts
 * (with it on, style and tone come only from the Look) and
 * services/storeDefaults.ts (the posting flow offers the signature Look and
 * the second Look instead of the classic style list). The playful style is
 * not named: the posting flow offers it whether or not the switch is on.
 */
export const CREATIVE_SYSTEM_NOTE =
  "Creative system gives a store its signature Look, and its second Look if one is chosen, instead of the classic style list. Only system admins can switch it.";

const CREATIVE_SYSTEM_UNREPORTED =
  "This server's dealer list doesn't report the creative system yet, so it can't be switched here.";

const SAVED_TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** Phones get the stacked list; `md` and up get the table. Matches Tailwind `md`. */
const PHONE_QUERY = "(max-width: 767px)";

const isPhoneViewport = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  Boolean(window.matchMedia(PHONE_QUERY)?.matches);

/**
 * One layout in the DOM at a time, so the board's state, drafts and saves
 * exist once and every control has one accessible instance.
 */
const useIsPhone = (): boolean => {
  const [isPhone, setIsPhone] = useState(isPhoneViewport);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(PHONE_QUERY);
    if (!query) return;
    const update = () => setIsPhone(Boolean(query.matches));
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener?.(update);
    return () => query.removeListener?.(update);
  }, []);
  return isPhone;
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** The store's logo, or its first letter, in a fixed tile. */
const StoreTile: React.FC<{ dealer: Dealer; size: "md" | "sm" }> = ({
  dealer,
  size,
}) => {
  const [failed, setFailed] = useState(false);
  const box = size === "md" ? "h-11 w-11 text-xl" : "h-10 w-10 text-lg";
  if (dealer.logo && !failed) {
    return (
      <img
        src={dealer.logo}
        alt=""
        onError={() => setFailed(true)}
        className={cn(
          box,
          "shrink-0 rounded-sm border border-hairline bg-panel-raised object-contain p-1",
        )}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        box,
        "grid shrink-0 place-items-center rounded-sm border border-strong bg-panel-raised font-display font-semibold text-ink",
      )}
    >
      {dealer.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
};

/** The missing mark: a warning ring. Quiet checks, loud gaps. */
const Ring: React.FC<{ className?: string }> = ({ className }) => (
  <span
    aria-hidden="true"
    className={cn(
      "inline-block shrink-0 rounded-full border-2 border-warning-ink bg-warning-fill",
      className ?? "h-4 w-4",
    )}
  />
);

const Dash: React.FC = () => (
  <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded-full bg-ink-3" />
);

/** One status cell: a check, a warning ring, or a dash when not reported. */
const StatusMark: React.FC<{ row: SetupRow | undefined; column: BoardColumn }> = ({
  row,
  column,
}) => {
  if (row?.counts && row.state === "ready") {
    return (
      <span
        role="img"
        aria-label={`${column.label} is set up`}
        className="inline-flex align-middle"
      >
        <Check
          className="h-[18px] w-[18px] text-ink-2"
          strokeWidth={2.25}
          aria-hidden
        />
      </span>
    );
  }
  if (row?.counts && row.state === "missing") {
    return (
      <span
        role="img"
        aria-label={`${column.label} is missing`}
        className="inline-flex align-middle"
      >
        <Ring />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={`${column.label}: not reported`}
      className="inline-flex align-middle"
    >
      <Dash />
    </span>
  );
};

/** A full-width row that opens and closes a block under it. */
const DisclosureRow: React.FC<{
  open: boolean;
  controls: string;
  onToggle: () => void;
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}> = ({ open, controls, onToggle, children, aside, className }) => (
  <button
    type="button"
    aria-expanded={open}
    aria-controls={controls}
    onClick={onToggle}
    className={cn(
      "flex min-h-11 w-full items-center justify-between gap-3 border-t border-hairline text-left text-[15px] font-semibold text-ink",
      className,
    )}
  >
    <span>{children}</span>
    <span className="flex items-center gap-3">
      {aside}
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "h-[18px] w-[18px] shrink-0 text-ink-2 transition-transform duration-180 ease-out motion-reduce:transition-none",
          open && "rotate-180",
        )}
      />
    </span>
  </button>
);

// ---------------------------------------------------------------------------
// The creative-system switch
// ---------------------------------------------------------------------------

const CreativeSystemControl: React.FC<{
  dealer: Dealer;
  saves: CreativeSystemSaves;
  labelledBy: string;
  describedBy: string;
}> = ({ dealer, saves, labelledBy, describedBy }) => {
  const reported = creativeFieldsReported(dealer);
  const checked = saves.checkedFor(dealer);
  const saving = saves.savingFor(dealer.id);
  const error = saves.errorFor(dealer.id);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-2.5">
        {/* The role announces the state; the word is for sighted users. */}
        <span aria-hidden="true" className="text-sm font-medium text-ink-2">
          {saving ? "Saving…" : checked ? "On" : "Off"}
        </span>
        <Switch
          checked={checked}
          onChange={(next) => saves.toggle(dealer, next)}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          disabled={!reported}
          busy={saving}
          showState={false}
        />
      </span>
      {/* Always mounted so the change is announced. */}
      <span role="status" className="sr-only">
        {saving ? "Saving…" : ""}
      </span>
      {error ? (
        <span role="alert" className="max-w-48 text-right text-caption text-error-ink">
          {error}
        </span>
      ) : null}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Setup notes
// ---------------------------------------------------------------------------

const NotesEditor: React.FC<{
  dealer: Dealer;
  notes: SetupNotes;
  /** The phone disclosure already names the editor. */
  hideLabel?: boolean;
}> = ({ dealer, notes, hideLabel = false }) => {
  const id = useId();
  const fieldId = `${id}-notes`;
  const hintId = `${id}-hint`;
  const statusRef = useRef<HTMLSpanElement>(null);
  const reported = setupNotesReported(dealer);
  const state = notes.stateFor(dealer.id);
  const dirty = notes.isDirty(dealer);
  const saving = state?.kind === "saving";
  const statusText = saving
    ? "Saving…"
    : dirty
      ? "Unsaved changes"
      : state?.kind === "saved"
        ? `Saved ${SAVED_TIME.format(state.at)}`
        : "";

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={fieldId}
        className={hideLabel ? "sr-only" : "text-base font-semibold text-ink"}
      >
        Setup notes
      </label>
      <textarea
        id={fieldId}
        rows={6}
        maxLength={SETUP_NOTES_MAX_LENGTH}
        value={notes.draftFor(dealer)}
        disabled={!reported}
        aria-describedby={hintId}
        onChange={(event) => notes.setDraft(dealer.id, event.target.value)}
        className="block w-full resize-y rounded-sm border border-strong bg-panel-raised px-3 py-2.5 text-base leading-[22px] text-ink transition-colors duration-120 ease-out placeholder:text-ink-hint focus:border-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span id={hintId} className="text-sm text-ink-2">
          {reported
            ? "Only system admins see these."
            : "This server's dealer list doesn't include setup notes yet, so they can't be saved here."}
        </span>
        <span className="flex min-h-11 items-center gap-3">
          {/* Focusable from script only: it takes focus from Save notes,
              which leaves while the notes save and does not come back once
              they are saved, so focus never falls to the page. */}
          <span
            ref={statusRef}
            tabIndex={-1}
            role="status"
            className="text-sm text-ink-2"
          >
            {statusText}
          </span>
          {dirty && !saving ? (
            <Button
              variant="secondary"
              className="px-3.5 text-sm"
              onClick={() => {
                notes.save(dealer);
                statusRef.current?.focus();
              }}
            >
              Save notes
            </Button>
          ) : null}
        </span>
      </div>
      {state?.kind === "error" ? (
        <p role="alert" className="text-sm text-error-ink">
          {state.message}
        </p>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// The open store
// ---------------------------------------------------------------------------

export interface SetupBoardActions {
  onEditDealer: (dealer: Dealer) => void;
  onDeleteDealer: (dealer: Dealer) => void;
  onOpenPeople: (dealerId: string, tab: "admins" | "users") => void;
  /**
   * Opens the store as this manager, on a settings section when one is
   * given. Rejects when the session could not be opened.
   */
  onOpenAs: (person: Person, section?: SettingsSectionId) => Promise<void>;
}

interface StoreDetailProps extends SetupBoardActions {
  dealer: Dealer;
  status: DealerSetupStatus;
  layout: "table" | "stack";
  isSystemAdmin: boolean;
  notes: SetupNotes;
  creative: CreativeSystemSaves;
  creativeNoteId: string;
  /** The store's name, for the phone switch's accessible name. */
  nameId: string;
  /** Someone is being opened as anywhere on the hub. */
  impersonating: boolean;
  fileOpen: boolean;
  onToggleFile: () => void;
  notesOpen: boolean;
  onToggleNotes: () => void;
}

const StoreDetail: React.FC<StoreDetailProps> = ({
  dealer,
  status,
  layout,
  isSystemAdmin,
  notes,
  creative,
  creativeNoteId,
  nameId,
  impersonating,
  fileOpen,
  onToggleFile,
  notesOpen,
  onToggleNotes,
  onEditDealer,
  onDeleteDealer,
  onOpenPeople,
  onOpenAs,
}) => {
  const id = useId();
  const stacked = layout === "stack";
  const missing = status.missing;

  // The store's managers, fetched when the store is opened. The page is the
  // one the Admins tab shows for this store, so both share one cache entry.
  const managersParams = storeManagersParams(dealer.id);
  const managers = useQuery({
    queryKey: peopleQueryKey(managersParams),
    queryFn: () => fetchPeoplePage(managersParams),
  });
  const manager = firstActiveManager(managers.data);
  const noManager = !managers.isPending && !managers.error && !manager;

  const [pending, setPending] = useState<SettingsSectionId | "manager" | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const canOpen = Boolean(manager) && !impersonating && pending === null;

  const openAsManager = async (section?: SettingsSectionId) => {
    if (!manager || !canOpen) return;
    setOpenError(null);
    setPending(section ?? "manager");
    try {
      await onOpenAs(manager, section);
    } catch (err) {
      setOpenError(toUiMessage(err, "Could not open this store as its manager."));
    } finally {
      setPending(null);
    }
  };

  const noManagerId = `${id}-no-manager`;
  const findingManagerId = `${id}-finding-manager`;
  const managerNote = managers.error ? (
    <p role="alert" className="text-sm text-error-ink">
      {toUiMessage(managers.error, "This store's managers could not be loaded.")}
    </p>
  ) : managers.isPending ? (
    // The open buttons wait for the manager; this says why they are disabled.
    <p id={findingManagerId} role="status" className="text-sm text-ink-2">
      Finding this store's manager…
    </p>
  ) : noManager ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p id={noManagerId} className="text-sm text-ink">
        This store has no active manager yet.
      </p>
      <Button
        variant="ghost"
        className="-ml-3 px-3 text-sm"
        onClick={() => onOpenPeople(dealer.id, "admins")}
      >
        Add a manager
      </Button>
    </div>
  ) : missing.length > 0 ? (
    <p className="text-sm text-ink-2">
      These buttons open the store's settings as its manager, on the right section.
    </p>
  ) : null;
  const describeOpen = noManager
    ? noManagerId
    : managers.isPending && !managers.error
      ? findingManagerId
      : undefined;

  const headingId = `${id}-left`;
  const missingBlock = (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col">
      {/* On phones the store's row already says what is missing. */}
      <h3
        id={headingId}
        className={stacked ? "sr-only" : "mb-1.5 text-base font-semibold text-ink"}
      >
        {missing.length
          ? `${plural(missing.length, "thing", "things")} left to set up`
          : "Everything is set up."}
      </h3>
      {missing.length > 0 ? (
        <ul className={cn(!stacked && "border-b border-hairline")}>
          {missing.map((row) => (
            <li
              key={row.id}
              className={cn(
                "flex items-center gap-x-4 gap-y-2 border-t border-hairline",
                stacked ? "py-3" : "flex-wrap py-3.5",
              )}
            >
              <span
                className={cn(
                  "flex min-w-0 flex-col gap-0.5",
                  stacked ? "flex-1" : "flex-[1_1_12.5rem]",
                )}
              >
                <span
                  className={cn(
                    "font-semibold text-ink",
                    stacked ? "text-[15px] leading-5" : "text-base",
                  )}
                >
                  {row.label}
                </span>
                {row.reason ? (
                  <span className="text-sm text-ink-2">{row.reason}</span>
                ) : null}
              </span>
              {row.section ? (
                <Button
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap px-3.5 text-sm"
                  disabled={!canOpen}
                  loading={pending === row.section}
                  aria-describedby={describeOpen}
                  onClick={() => void openAsManager(row.section ?? undefined)}
                >
                  Open {SETTINGS_SECTION_LABELS[row.section]}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {missing.length > 0 && managerNote ? (
        <div className="mt-2.5">{managerNote}</div>
      ) : null}
    </section>
  );

  const fileId = `${id}-file`;
  const fileBlock = (
    <div className={cn(!stacked && "mt-3")}>
      <DisclosureRow
        open={fileOpen}
        controls={fileId}
        onToggle={onToggleFile}
        className={cn(!stacked && !fileOpen && "border-b")}
      >
        Everything on file
      </DisclosureRow>
      {fileOpen ? (
        <dl
          id={fileId}
          className={cn(
            "divide-y divide-hairline border-hairline",
            stacked ? "border-t" : "border-y",
          )}
        >
          {status.rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 py-2.5"
            >
              <dt className="text-sm font-medium text-ink">{row.label}</dt>
              <dd className="min-w-0 text-sm text-ink-2">
                {row.value.length
                  ? row.value.map((line, index) => (
                      <span
                        key={`${row.id}-${index}`}
                        className={cn(
                          "block break-words",
                          row.id === "voice" && "line-clamp-3",
                        )}
                      >
                        {row.swatch && index === row.value.length - 1 ? (
                          <span
                            aria-hidden="true"
                            className="mr-1.5 inline-block h-3.5 w-3.5 rounded-full border border-hairline align-[-2px]"
                            style={{ backgroundColor: row.swatch }}
                          />
                        ) : null}
                        {line}
                      </span>
                    ))
                  : SETUP_STATE_LABELS[row.state]}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );

  const notesId = `${id}-notes-panel`;
  const notesBlock = isSystemAdmin ? (
    stacked ? (
      <div>
        <DisclosureRow
          open={notesOpen}
          controls={notesId}
          onToggle={onToggleNotes}
          aside={
            !notesOpen && notes.isDirty(dealer) ? (
              <span className="text-sm font-normal text-ink-2">Unsaved changes</span>
            ) : null
          }
        >
          Setup notes
        </DisclosureRow>
        {notesOpen ? (
          <div id={notesId} className="pb-1 pt-2">
            <NotesEditor dealer={dealer} notes={notes} hideLabel />
          </div>
        ) : null}
      </div>
    ) : (
      <NotesEditor dealer={dealer} notes={notes} />
    )
  ) : null;

  const sampleHeadingId = `${id}-sample`;
  const shownLook = sampleLook(dealer);
  const sampleAlt = shownLook
    ? "Sample photo in this store's Look"
    : "Sample photo with no Look applied";
  const sampleBlock = stacked ? (
    <section
      aria-labelledby={sampleHeadingId}
      className="flex items-start gap-3 border-t border-hairline pt-3"
    >
      <div className="table-lit w-24 shrink-0 rounded-sm border border-hairline p-1.5">
        <SamplePhoto dealer={dealer} alt={sampleAlt} />
      </div>
      <div className="min-w-0 space-y-1">
        <h3
          id={sampleHeadingId}
          className="text-[15px] font-semibold leading-5 text-ink"
        >
          This store's posts
        </h3>
        <p className="text-sm text-ink-2">{looksInWords(dealer)}</p>
      </div>
    </section>
  ) : (
    <section aria-labelledby={sampleHeadingId} className="flex flex-col gap-2">
      <h3 id={sampleHeadingId} className="text-base font-semibold text-ink">
        This store's posts
      </h3>
      <div className="table-lit rounded-md border border-hairline p-3.5">
        <SamplePhoto dealer={dealer} alt={sampleAlt} />
      </div>
      <p className="text-sm text-ink-2">{looksInWords(dealer)}</p>
    </section>
  );

  const actions = (
    <div className="flex flex-col gap-3">
      {missing.length === 0 && managerNote ? managerNote : null}
      {openError ? (
        <p role="alert" className="text-sm text-error-ink">
          {openError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          className="px-4 text-sm"
          disabled={!canOpen}
          loading={pending === "manager"}
          aria-describedby={describeOpen}
          onClick={() => void openAsManager()}
        >
          Open as manager
        </Button>
        <Button
          variant="ghost"
          className="px-3.5 text-sm"
          onClick={() => onOpenPeople(dealer.id, "admins")}
        >
          Admins
        </Button>
        <Button
          variant="ghost"
          className="px-3.5 text-sm"
          onClick={() => onOpenPeople(dealer.id, "users")}
        >
          Users
        </Button>
        <Button
          variant="ghost"
          className="px-3.5 text-sm"
          onClick={() => onEditDealer(dealer)}
        >
          Edit name and logo
        </Button>
        <span aria-hidden="true" className="hidden flex-1 sm:block" />
        <Button
          variant="ghost"
          className="px-3.5 text-sm text-error-ink"
          onClick={() => onDeleteDealer(dealer)}
        >
          Delete dealership
        </Button>
      </div>
    </div>
  );

  if (stacked) {
    const approval = approvalCell(dealer);
    const switchLabelId = `${id}-creative`;
    const unreportedNoteId = `${id}-creative-unreported`;
    const creativeReported = creativeFieldsReported(dealer);
    return (
      <div className="flex flex-col gap-4">
        {missing.length > 0 ? missingBlock : null}
        <div className="flex flex-col">
          <div className="flex min-h-11 items-center justify-between gap-3 border-t border-hairline py-2">
            <span className="text-[15px] font-semibold leading-5 text-ink">
              Approval
            </span>
            <span
              className={cn(
                "text-right text-sm",
                approval.off ? "text-ink-2" : "text-ink",
              )}
            >
              {approval.text}
            </span>
          </div>
          {isSystemAdmin ? (
            <div className="flex items-center justify-between gap-3 border-t border-hairline py-1">
              <span
                id={switchLabelId}
                className="text-[15px] font-semibold leading-5 text-ink"
              >
                Creative system
              </span>
              <CreativeSystemControl
                dealer={dealer}
                saves={creative}
                labelledBy={`${switchLabelId} ${nameId}`}
                describedBy={
                  creativeReported
                    ? creativeNoteId
                    : `${creativeNoteId} ${unreportedNoteId}`
                }
              />
            </div>
          ) : null}
          {isSystemAdmin && !creativeReported ? (
            <p id={unreportedNoteId} className="pb-2 text-caption text-ink-2">
              {CREATIVE_SYSTEM_UNREPORTED}
            </p>
          ) : null}
          {fileBlock}
          {notesBlock}
        </div>
        {sampleBlock}
        {actions}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-x-10 gap-y-8 pb-6 pl-[4.625rem] pr-6 pt-2">
      <div className="flex min-w-0 flex-[999_1_35rem] flex-col gap-6">
        <div className="flex flex-wrap items-start gap-x-10 gap-y-8">
          <div className="flex min-w-0 flex-[1_1_18.75rem] flex-col">
            {missingBlock}
            {fileBlock}
          </div>
          {notesBlock ? (
            <div className="min-w-0 flex-[1_1_18.75rem]">{notesBlock}</div>
          ) : null}
        </div>
        {actions}
      </div>
      <div className="w-[13.5rem] shrink-0">{sampleBlock}</div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export interface SetupBoardProps extends SetupBoardActions {
  /** The stores, without the system dealer. */
  dealers: Dealer[];
  loading: boolean;
  loadFailed: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onAddDealer: () => void;
  /** Someone is being opened as anywhere on the hub. */
  impersonating: boolean;
}

/**
 * The system administrator's setup board: one row per store and one column
 * per thing a store has to set up (utils/dealerSetupStatus.ts decides what
 * that is), with each store's missing items, setup notes, sample post and
 * actions one click away. A table from `md`, a stacked list on phones.
 */
export const SetupBoard: React.FC<SetupBoardProps> = ({
  dealers,
  loading,
  loadFailed,
  refreshing,
  onRefresh,
  onAddDealer,
  impersonating,
  ...actions
}) => {
  const id = useId();
  const isPhone = useIsPhone();
  const isSystemAdmin = useAppStore((s) => s.role) === "super_admin";
  const notes = useSetupNotes();
  const creative = useCreativeSystemSaves();
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [fileOpen, setFileOpen] = useState<Record<string, boolean>>({});
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({});

  const statuses = useMemo(
    () => new Map(dealers.map((dealer) => [dealer.id, dealerSetupStatus(dealer)])),
    [dealers],
  );
  const columns = useMemo(() => boardColumns([...statuses.values()]), [statuses]);
  const summary = useMemo(() => boardSummary(dealers), [dealers]);
  const query = search.trim().toLocaleLowerCase();
  const visible = query
    ? dealers.filter((dealer) => dealer.name.toLocaleLowerCase().includes(query))
    : dealers;
  const anyUnreported =
    isSystemAdmin && dealers.some((d) => !creativeFieldsReported(d));
  const anyNotReportedCell = dealers.some((dealer) =>
    columns.some((column) => {
      const row = statuses.get(dealer.id)?.rows.find((item) => item.id === column.id);
      return !row?.counts;
    }),
  );

  const creativeNoteId = `${id}-creative-note`;
  const unreportedId = `${id}-creative-unreported`;
  const creativeHeaderId = `${id}-col-creative`;
  const nameIdFor = (dealer: Dealer) => `${id}-name-${dealer.id}`;
  const detailIdFor = (dealer: Dealer) => `${id}-detail-${dealer.id}`;
  const toggle = (dealerId: string) =>
    setOpenId((current) => (current === dealerId ? null : dealerId));

  const detailFor = (dealer: Dealer, layout: "table" | "stack") => (
    <StoreDetail
      dealer={dealer}
      status={statuses.get(dealer.id) ?? dealerSetupStatus(dealer)}
      layout={layout}
      isSystemAdmin={isSystemAdmin}
      notes={notes}
      creative={creative}
      creativeNoteId={creativeNoteId}
      nameId={nameIdFor(dealer)}
      impersonating={impersonating}
      fileOpen={Boolean(fileOpen[dealer.id])}
      onToggleFile={() =>
        setFileOpen((current) => ({ ...current, [dealer.id]: !current[dealer.id] }))
      }
      notesOpen={Boolean(notesOpen[dealer.id])}
      onToggleNotes={() =>
        setNotesOpen((current) => ({ ...current, [dealer.id]: !current[dealer.id] }))
      }
      {...actions}
    />
  );

  const addButton = (
    <Button
      variant="primary"
      className={cn("shrink-0", isPhone ? "px-4 text-sm" : "px-5 text-[15px]")}
      onClick={onAddDealer}
    >
      Add dealer
    </Button>
  );

  const header = (
    <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-x-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="font-display text-[1.625rem] font-semibold leading-[1.875rem] tracking-[-0.01em] text-ink md:text-3xl">
            Setup board
          </h2>
          {summary && !loading ? (
            <p className="text-sm text-ink-2 md:text-base">{summary}</p>
          ) : null}
        </div>
        {isPhone ? addButton : null}
      </div>
      <div className="flex items-center gap-3">
        <RefreshButton busy={refreshing} onClick={onRefresh} />
        <input
          type="search"
          aria-label="Find a dealership"
          placeholder="Find a dealership"
          value={search}
          onChange={(event) => setSearch(event.target.value.slice(0, 120))}
          className="min-h-11 min-w-0 flex-1 rounded-sm border border-strong bg-panel-raised px-3 text-base text-ink transition-colors duration-120 ease-out placeholder:text-ink-hint focus:border-brand-ink md:w-64 md:flex-none"
        />
        {isPhone ? null : addButton}
      </div>
    </div>
  );

  const footnotes = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-3">
        {!isPhone ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-2">
            <span className="flex items-center gap-2">
              <Check className="h-4 w-4" strokeWidth={2.25} aria-hidden />
              Set up
            </span>
            <span className="flex items-center gap-2">
              <Ring className="h-3.5 w-3.5" />
              Missing
            </span>
            {anyNotReportedCell ? (
              <span className="flex items-center gap-2">
                <Dash />
                Not reported
              </span>
            ) : null}
          </div>
        ) : null}
        {isSystemAdmin ? (
          <p id={creativeNoteId} className="max-w-[62ch] text-sm text-ink-2">
            {CREATIVE_SYSTEM_NOTE}
          </p>
        ) : null}
      </div>
      {anyUnreported && !isPhone ? (
        <p id={unreportedId} className="text-sm text-ink-2">
          {CREATIVE_SYSTEM_UNREPORTED}
        </p>
      ) : null}
    </div>
  );

  const colCount = 1 + columns.length + 1 + (isSystemAdmin ? 1 : 0) + 1;
  const cellBorder = "border-b border-hairline";

  const table = (
    <div className="overflow-x-auto">
      <table
        aria-busy={loading || undefined}
        className="w-full min-w-[60rem] table-fixed border-collapse"
      >
        <caption className="sr-only">Setup status for each dealership</caption>
        <colgroup>
          <col />
          {columns.map((column) => (
            <col key={column.id} className="w-[4.5rem]" />
          ))}
          <col className="w-48" />
          {isSystemAdmin ? <col className="w-40" /> : null}
          <col className="w-11" />
        </colgroup>
        <thead>
          <tr className="text-caption font-semibold text-ink-2">
            <th
              scope="col"
              className={cn(cellBorder, "pb-2.5 pl-4 pr-3 text-left font-semibold")}
            >
              Dealership
            </th>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(cellBorder, "px-1 pb-2.5 text-center font-semibold")}
              >
                {column.header}
              </th>
            ))}
            <th
              scope="col"
              className={cn(cellBorder, "pb-2.5 pl-7 pr-3 text-left font-semibold")}
            >
              Approval
            </th>
            {isSystemAdmin ? (
              <th
                scope="col"
                id={creativeHeaderId}
                className={cn(cellBorder, "px-2 pb-2.5 text-right font-semibold")}
              >
                Creative system
              </th>
            ) : null}
            <th scope="col" className={cn(cellBorder, "pb-2.5")}>
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? [0, 1, 2].map((index) => (
                <tr key={index} aria-hidden="true">
                  <td className={cn(cellBorder, "h-[72px] pl-4 pr-3")}>
                    <span className="flex items-center gap-3.5">
                      <Skeleton className="h-11 w-11 shrink-0 rounded-sm" />
                      <span className="flex flex-1 flex-col gap-2">
                        <Skeleton className="h-4 w-40 max-w-full" />
                        <Skeleton className="h-3 w-24 max-w-full" />
                      </span>
                    </span>
                  </td>
                  {columns.map((column) => (
                    <td key={column.id} className={cn(cellBorder, "text-center")}>
                      <Skeleton className="mx-auto h-4 w-4 rounded-full" />
                    </td>
                  ))}
                  <td className={cn(cellBorder, "pl-7 pr-3")}>
                    <Skeleton className="h-4 w-24" />
                  </td>
                  {isSystemAdmin ? (
                    <td className={cn(cellBorder, "px-2")}>
                      <Skeleton className="ml-auto h-7 w-12 rounded-full" />
                    </td>
                  ) : null}
                  <td className={cellBorder} />
                </tr>
              ))
            : visible.map((dealer) => {
                const status = statuses.get(dealer.id) ?? dealerSetupStatus(dealer);
                const open = openId === dealer.id;
                const approval = approvalCell(dealer);
                const website = displayUrl(dealer.website || "");
                const rowBg = open ? "bg-panel" : "";
                return (
                  <React.Fragment key={dealer.id}>
                    <tr
                      className={cn(
                        "cursor-pointer transition-colors duration-120 ease-out",
                        open ? "bg-panel" : "hover:bg-fill-subtle",
                      )}
                      onClick={(event) => {
                        // The name button and the switch handle their own
                        // clicks; anywhere else on the row opens it too.
                        const target = event.target as HTMLElement;
                        if (target.closest("button, a, input, textarea, select"))
                          return;
                        if (window.getSelection?.()?.toString()) return;
                        toggle(dealer.id);
                      }}
                    >
                      <th
                        scope="row"
                        className={cn(
                          cellBorder,
                          rowBg,
                          "h-[72px] py-2 pl-4 pr-3 text-left font-normal",
                        )}
                      >
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={detailIdFor(dealer)}
                          onClick={() => toggle(dealer.id)}
                          className="flex min-h-14 w-full items-center gap-3.5 rounded-sm text-left"
                        >
                          <StoreTile dealer={dealer} size="md" />
                          <span className="flex min-w-0 flex-col">
                            <span
                              id={nameIdFor(dealer)}
                              className="truncate text-[17px] font-semibold leading-[22px] text-ink"
                            >
                              {dealer.name}
                            </span>
                            {website ? (
                              <span className="truncate text-sm text-ink-2">
                                {website}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </th>
                      {columns.map((column) => (
                        <td
                          key={column.id}
                          className={cn(cellBorder, rowBg, "px-1 text-center")}
                        >
                          <StatusMark
                            row={status.rows.find((row) => row.id === column.id)}
                            column={column}
                          />
                        </td>
                      ))}
                      <td
                        className={cn(
                          cellBorder,
                          rowBg,
                          "pl-7 pr-3 text-[15px] leading-5",
                          approval.off ? "text-ink-2" : "text-ink",
                        )}
                      >
                        {approval.text}
                      </td>
                      {isSystemAdmin ? (
                        <td
                          className={cn(
                            cellBorder,
                            rowBg,
                            "cursor-default px-2 py-2 text-right",
                          )}
                          // The switch's own cell never opens the row.
                          onClick={(event) => event.stopPropagation()}
                        >
                          <CreativeSystemControl
                            dealer={dealer}
                            saves={creative}
                            labelledBy={`${creativeHeaderId} ${nameIdFor(dealer)}`}
                            describedBy={
                              creativeFieldsReported(dealer)
                                ? creativeNoteId
                                : `${creativeNoteId} ${unreportedId}`
                            }
                          />
                        </td>
                      ) : null}
                      <td className={cn(cellBorder, rowBg, "pr-3 text-right")}>
                        <ChevronDown
                          aria-hidden="true"
                          className={cn(
                            "ml-auto h-[18px] w-[18px] text-ink-2 transition-transform duration-180 ease-out motion-reduce:transition-none",
                            open && "rotate-180",
                          )}
                        />
                      </td>
                    </tr>
                    {open ? (
                      <tr id={detailIdFor(dealer)} className="bg-panel">
                        <td colSpan={colCount} className={cn(cellBorder, "p-0")}>
                          {detailFor(dealer, "table")}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
        </tbody>
      </table>
    </div>
  );

  const list = (
    <ul aria-busy={loading || undefined} className="border-b border-hairline">
      {loading
        ? [0, 1, 2].map((index) => (
            <li
              key={index}
              aria-hidden="true"
              className="flex min-h-[68px] items-center gap-3 border-t border-hairline py-3"
            >
              <Skeleton className="h-10 w-10 shrink-0 rounded-sm" />
              <span className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-44 max-w-full" />
                <Skeleton className="h-3 w-28 max-w-full" />
              </span>
            </li>
          ))
        : visible.map((dealer) => {
            const status = statuses.get(dealer.id) ?? dealerSetupStatus(dealer);
            const open = openId === dealer.id;
            const line = missingLine(status);
            return (
              <li key={dealer.id} className="border-t border-hairline">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={detailIdFor(dealer)}
                  onClick={() => toggle(dealer.id)}
                  className="flex min-h-[68px] w-full items-center gap-3 py-3 text-left"
                >
                  <StoreTile dealer={dealer} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      id={nameIdFor(dealer)}
                      className="truncate text-base font-semibold text-ink"
                    >
                      {dealer.name}
                    </span>
                    {line ? (
                      <span className="text-sm text-warning-ink">{line}</span>
                    ) : creativeFieldsReported(dealer) ? (
                      <span className="flex items-center gap-1.5 text-sm text-ink-2">
                        <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                        Everything is set up
                      </span>
                    ) : (
                      <span className="text-sm text-ink-2">{status.summary}</span>
                    )}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "h-[18px] w-[18px] shrink-0 text-ink-2 transition-transform duration-180 ease-out motion-reduce:transition-none",
                      open && "rotate-180",
                    )}
                  />
                </button>
                {open ? (
                  <div id={detailIdFor(dealer)} className="pb-5 pl-[3.25rem]">
                    {detailFor(dealer, "stack")}
                  </div>
                ) : null}
              </li>
            );
          })}
    </ul>
  );

  const empty = !loading && !loadFailed && dealers.length === 0;
  const noMatch = !loading && dealers.length > 0 && visible.length === 0;

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      {header}
      {loadFailed ? (
        <p className="text-sm text-error-ink" role="alert">
          Failed to load dealerships. Try refresh.
        </p>
      ) : null}
      {empty ? (
        <p className="border-y border-hairline py-10 text-center text-sm text-ink-2">
          No dealerships yet. Add your first store to get started.
        </p>
      ) : noMatch ? (
        <p className="border-y border-hairline py-8 text-sm text-ink-2">
          No dealership matches “{search.trim()}”.
        </p>
      ) : loadFailed && dealers.length === 0 ? null : (
        <div className="flex flex-col gap-4">
          {isPhone ? list : table}
          {footnotes}
        </div>
      )}
    </div>
  );
};
