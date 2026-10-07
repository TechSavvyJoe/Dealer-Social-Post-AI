import React, { useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Check, Copy } from "lucide-react";
import { PersonEditModal } from "./PersonEditModal";
import type { CredentialResult, Person } from "../services/salespeople";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Leaderboard } from "./Leaderboard";
import { ApprovalQueue } from "./ApprovalQueue";
import { PostHistory } from "./PostHistory";
import { DealerSetupWizard } from "./DealerSetupWizard";
import { useAppStore } from "../stores/appStore";
import * as db from "../services/database";
import { cn } from "../utils/classNames";
import { toUiMessage } from "../utils/errorMessages";
import { triggerHapticFeedback } from "../utils/haptics";
import type { GeneratedPost } from "../types";
import { getLeaderboard } from "../services/posts";
import {
  SETTINGS_SECTION_LABELS,
  type SettingsSectionId,
} from "../utils/dealerSetupStatus";
import {
  ChannelsSection,
  initialOpenChannels,
  type ChannelKey,
} from "./dealer-settings/ChannelsSection";
import {
  CreativeSection,
  creativeStatusSentence,
} from "./dealer-settings/CreativeSection";
import { ProfileSection } from "./dealer-settings/ProfileSection";
import { SampleAside, SampleStrip } from "./dealer-settings/SampleAside";
import {
  SettingsActionRow,
  DiscardSettingsDialog,
} from "./dealer-settings/SettingsActionRow";
import { SettingsRail } from "./dealer-settings/SettingsRail";
import { SECTION_MARK, SECTION_SENTENCES } from "./dealer-settings/settingsModel";
import { VoiceSection } from "./dealer-settings/VoiceSection";
import { WorkflowSection } from "./dealer-settings/WorkflowSection";
import {
  useDealerSettingsForm,
  useReportDirty,
} from "./dealer-settings/useDealerSettingsForm";

/**
 * The three Signature Looks the settings offer, with the description each
 * one shows. Defined beside the rest of the settings model; exported here
 * too, where it has always been exported from.
 */
export { SIGNATURE_LOOK_OPTIONS } from "./dealer-settings/settingsModel";

/**
 * Per-dealership admin dashboard. The GSM/GM lands here when they log in
 * with their personal four-digit manager code.
 *
 * Scoped to their own dealership only — all the data on this screen
 * (leaderboard, approvals, history) is already filtered to the session
 * dealer by the /api/app/posts endpoint, so nothing leaks across tenants.
 *
 * Distinct from the super-admin AdminDashboard which manages MANY dealers
 * across the platform.
 */
type Tab = "overview" | "settings" | "team";

const TABS: ReadonlyArray<{ key: Tab; label: string; title: string }> = [
  { key: "overview", label: "Overview", title: "Manager dashboard" },
  { key: "settings", label: "Settings", title: "Dealership settings" },
  { key: "team", label: "Team", title: "Your team" },
];

export interface DealerAdminDashboardProps {
  onSettingsDirtyChange?: (dirty: boolean) => void;
  /**
   * Opens a saved post from the Overview's history through the app's own
   * guarded path (the "Discard the post in progress?" prompt and the rest of
   * its reopen handling). Without it the history opens the post directly.
   */
  onOpenPost?: (post: GeneratedPost) => void;
}

export const DealerAdminDashboard: React.FC<DealerAdminDashboardProps> = ({
  onSettingsDirtyChange,
  onOpenPost,
}) => {
  const dealer = useAppStore((s) => s.currentDealer);
  // The system admin's setup board can open this dashboard on one settings
  // section. The entry is read once, on mount, and cleared at once, so a
  // later visit opens the dashboard as usual.
  const [entrySection, setEntrySection] = useState<SettingsSectionId | null>(
    () => useAppStore.getState().managerEntry?.section ?? null,
  );
  const [tab, setTab] = useState<Tab>(() => (entrySection ? "settings" : "overview"));
  const [settingsDirty, setSettingsDirty] = useState(false);

  useEffect(() => {
    if (useAppStore.getState().managerEntry)
      useAppStore.getState().setManagerEntry(null);
  }, []);

  // The deep link opens one section once; coming back to Settings later
  // starts on Store profile as usual.
  useEffect(() => {
    if (tab !== "settings") setEntrySection(null);
  }, [tab]);

  useEffect(() => {
    onSettingsDirtyChange?.(settingsDirty);
  }, [onSettingsDirtyChange, settingsDirty]);

  useEffect(
    () => () => {
      onSettingsDirtyChange?.(false);
    },
    [onSettingsDirtyChange],
  );
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  const tabRefs = React.useRef<Record<Tab, HTMLButtonElement | null>>({
    overview: null,
    settings: null,
    team: null,
  });

  // First-time setup wizard surfaces if brand voice + color aren't set yet.
  const [wizardDismissed, setWizardDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return dealer
        ? localStorage.getItem(`dsp.dealerSetupDismissed.v1.${dealer.id}`) === "1"
        : false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!dealer || typeof window === "undefined") return;
    try {
      setWizardDismissed(
        localStorage.getItem(`dsp.dealerSetupDismissed.v1.${dealer.id}`) === "1",
      );
    } catch {
      setWizardDismissed(false);
    }
  }, [dealer?.id]);
  const needsSetup = Boolean(dealer && (!dealer.brand_voice || !dealer.brand_color));
  // The wizard's own Finish setup can fill in the voice and colour. While that
  // save is in flight and its success state shows, wizardFinishing keeps the
  // wizard on screen until it dismisses itself. Nothing else sets it: a
  // Settings-tab save that completes the store makes the wizard go away, so it
  // can never linger holding entries older than that save.
  const [wizardFinishing, setWizardFinishing] = useState(false);
  const showWizard = !wizardDismissed && dealer && (needsSetup || wizardFinishing);

  useEffect(() => {
    if (!settingsDirty) return;
    const preventAccidentalUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalUnload);
    return () => window.removeEventListener("beforeunload", preventAccidentalUnload);
  }, [settingsDirty]);

  if (!dealer) {
    return (
      <div className="p-8 text-center text-ink-2">
        <Loader2 className="mx-auto h-6 w-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  const handleWizardSave = async (fields: Record<string, string | boolean>) => {
    const authEpoch = useAppStore.getState().authEpoch;
    const savedDealerId = dealer.id;
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) =>
      fd.append(k, typeof v === "boolean" ? (v ? "true" : "false") : v),
    );
    const updated = await db.updateDealerWithFile(dealer.id, fd);
    // The PATCH body carries structured brand fields as JSON text ("[]", "",
    // '{"mode":"first_n",…}'), and the route answers with only { id }. Merge
    // the decoded values so the session dealer keeps arrays, objects and null
    // — the settings form compares against these, and the creative and
    // approval resolvers read them. Plain text fields and booleans are
    // already in their stored form.
    const decodedBrand = db.pickDealerBrandFields(fields);
    const decoded: Record<string, unknown> = { ...fields };
    for (const key of db.DEALER_BRAND_FIELDS) {
      if (key in fields) decoded[key] = decodedBrand[key];
    }
    useAppStore.setState((s) => ({
      currentDealer:
        s.authEpoch === authEpoch && s.currentDealer?.id === savedDealerId
          ? {
              ...s.currentDealer,
              ...(decoded as Partial<typeof s.currentDealer>),
              ...updated,
            }
          : s.currentDealer,
    }));
    return updated;
  };

  const requestTab = (nextTab: Tab) => {
    if (nextTab === tab) return;
    if (tab === "settings" && settingsDirty) {
      setPendingTab(nextTab);
      return;
    }
    setTab(nextTab);
  };

  const tabOrder: Tab[] = ["overview", "settings", "team"];
  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentTab: Tab,
  ) => {
    let nextIndex: number | null = null;
    const currentIndex = tabOrder.indexOf(currentTab);
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabOrder.length;
    if (event.key === "ArrowLeft")
      nextIndex = (currentIndex - 1 + tabOrder.length) % tabOrder.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabOrder.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabOrder[nextIndex];
    requestTab(nextTab);
    if (!(tab === "settings" && settingsDirty)) {
      requestAnimationFrame(() => tabRefs.current[nextTab]?.focus());
    }
  };

  const title = TABS.find((entry) => entry.key === tab)?.title ?? "Manager dashboard";

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 sm:pt-6 lg:px-8 lg:pt-10">
      {showWizard && (
        <div className="pb-6 pt-4 sm:pt-0">
          <DealerSetupWizard
            dealer={dealer}
            onSave={async (fields) => {
              // Set before the store update, so the record that completes the
              // store never unmounts the wizard ahead of its success state.
              setWizardFinishing(true);
              try {
                return await handleWizardSave(fields);
              } catch (err) {
                setWizardFinishing(false);
                throw err;
              }
            }}
            onDismiss={() => {
              setWizardFinishing(false);
              setWizardDismissed(true);
              try {
                localStorage.setItem(`dsp.dealerSetupDismissed.v1.${dealer.id}`, "1");
              } catch {
                /* ignore */
              }
            }}
          />
        </div>
      )}

      {/* The page title and the three text tabs share one row over one
          hairline. On phones the app header already names the dealership, so
          the title is visually hidden (it stays the page's h1) and the tab row
          sticks to the top so managers can switch without scrolling up. */}
      <div className="sticky top-0 z-20 -mx-4 bg-canvas px-4 sm:static sm:mx-0 sm:px-0">
        <div className="flex flex-wrap items-end justify-between gap-x-8 border-b border-hairline">
          <h1 className="sr-only sm:not-sr-only sm:mb-3.5 sm:text-4xl sm:leading-10">
            {title}
          </h1>
          <div
            role="tablist"
            aria-label="Manager dashboard"
            className="flex gap-6 sm:gap-7"
          >
            {TABS.map((t) => {
              const selected = tab === t.key;
              return (
                <button
                  ref={(element) => {
                    tabRefs.current[t.key] = element;
                  }}
                  key={t.key}
                  id={`manager-tab-${t.key}`}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  aria-controls={`manager-panel-${t.key}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => {
                    triggerHapticFeedback();
                    requestTab(t.key);
                  }}
                  onKeyDown={(event) => handleTabKeyDown(event, t.key)}
                  className={cn(
                    "relative -mb-px flex min-h-11 items-center border-b-2 text-sm font-semibold transition-colors duration-120 ease-out sm:text-base",
                    selected
                      ? "border-brand-fill text-ink"
                      : "border-transparent text-ink-2 hover:text-ink",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {tab === "overview" && (
        <div
          id="manager-panel-overview"
          role="tabpanel"
          aria-labelledby="manager-tab-overview"
          className="max-w-5xl space-y-6 pt-6 lg:pt-9"
        >
          <Leaderboard />
          <ApprovalQueue />
          <PostHistory onPostReady={onOpenPost} />
        </div>
      )}

      {tab === "settings" && (
        <div
          id="manager-panel-settings"
          role="tabpanel"
          aria-labelledby="manager-tab-settings"
          className="lg:pt-9"
        >
          <DealerSettingsCard
            dealer={dealer}
            onSaved={handleWizardSave}
            onDirtyChange={setSettingsDirty}
            initialSection={entrySection ?? undefined}
          />
        </div>
      )}

      {tab === "team" && (
        <div
          id="manager-panel-team"
          role="tabpanel"
          aria-labelledby="manager-tab-team"
          className="max-w-5xl pt-6 lg:pt-9"
        >
          <DealerTeamCard />
        </div>
      )}

      <DiscardSettingsDialog
        isOpen={pendingTab !== null}
        onKeep={() => setPendingTab(null)}
        onDiscard={() => {
          if (!pendingTab) return;
          const nextTab = pendingTab;
          setPendingTab(null);
          setSettingsDirty(false);
          setTab(nextTab);
          requestAnimationFrame(() => tabRefs.current[nextTab]?.focus());
        }}
      />
    </div>
  );
};

// ----------------------------------------------------------------------------
// Dealership settings: one form, five sections, the sample post beside them
// ----------------------------------------------------------------------------
interface DealerSettingsProps {
  dealer: NonNullable<ReturnType<typeof useAppStore.getState>["currentDealer"]>;
  onSaved: (fields: Record<string, string | boolean>) => Promise<unknown>;
  onDirtyChange: (dirty: boolean) => void;
  /** Open on this section instead of Store profile (the admin's deep link). */
  initialSection?: SettingsSectionId;
}

/**
 * The manager's Dealership settings. The open section lives here, outside the
 * form, so Discard can drop every unsaved value by remounting the form while
 * the manager stays on the section they were in.
 */
export const DealerSettingsCard: React.FC<DealerSettingsProps> = ({
  dealer,
  onSaved,
  onDirtyChange,
  initialSection,
}) => {
  const [section, setSection] = useState<SettingsSectionId>(
    initialSection ?? "profile",
  );
  const [formKey, setFormKey] = useState(0);
  return (
    <DealerSettingsForm
      key={formKey}
      dealer={dealer}
      onSaved={onSaved}
      onDirtyChange={onDirtyChange}
      section={section}
      onSectionChange={setSection}
      focusTitleOnMount={formKey > 0}
      onDiscarded={() => setFormKey((key) => key + 1)}
    />
  );
};

interface DealerSettingsFormProps extends DealerSettingsProps {
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  /** After a Discard, focus lands on the section title (Discard has gone). */
  focusTitleOnMount: boolean;
  onDiscarded: () => void;
}

/**
 * Three columns from `lg` (rail, form, sample); below `lg` the chip row, the
 * form with the collapsed sample strip under its title, and the sticky save
 * bar. Only the open section renders; the form state lives in
 * `useDealerSettingsForm`, so switching sections keeps every edit.
 */
const DealerSettingsForm: React.FC<DealerSettingsFormProps> = ({
  dealer,
  onSaved,
  onDirtyChange,
  section,
  onSectionChange,
  focusTitleOnMount,
  onDiscarded,
}) => {
  const form = useDealerSettingsForm(dealer, onSaved);
  useReportDirty(form.dirty, onDirtyChange);
  const [openChannels, setOpenChannels] = useState<Record<ChannelKey, boolean>>(() =>
    initialOpenChannels(dealer),
  );
  const [creativeAdvancedOpen, setCreativeAdvancedOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const mark = SECTION_MARK[section];

  useEffect(() => {
    // Mount only: the flag belongs to the remount that Discard caused.
    if (focusTitleOnMount) titleRef.current?.focus();
  }, []);

  return (
    <div className="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)_20rem] lg:items-start lg:gap-x-10 xl:grid-cols-[11.875rem_minmax(0,1fr)_minmax(20rem,23.75rem)] xl:gap-x-12">
      <SettingsRail
        dealer={dealer}
        section={section}
        onSelect={onSectionChange}
        className="lg:sticky lg:top-6"
      />

      <div className="flex min-w-0 flex-col gap-7">
        <header className="flex flex-col gap-1 pt-1 lg:pt-0">
          {/* No outline override: after a keyboard Discard the global
              :focus-visible ring shows where focus landed; a mouse Discard
              gets no ring. */}
          <h2 ref={titleRef} tabIndex={-1} className="text-3xl leading-8 text-ink">
            {SETTINGS_SECTION_LABELS[section]}
          </h2>
          <p className="max-w-[52ch] text-base text-ink-2">
            {SECTION_SENTENCES[section]}
          </p>
          {section === "creative" ? (
            <p className="mt-2 max-w-[60ch] text-sm text-ink-2">
              {creativeStatusSentence(dealer)}
            </p>
          ) : null}
        </header>

        <SampleStrip draft={form.draft} mark={mark} className="flex lg:hidden" />

        {section === "profile" ? <ProfileSection form={form} /> : null}
        {section === "channels" ? (
          <ChannelsSection
            form={form}
            dealer={dealer}
            open={openChannels}
            onToggle={(channel) =>
              setOpenChannels((current) => ({
                ...current,
                [channel]: !current[channel],
              }))
            }
          />
        ) : null}
        {section === "voice" ? <VoiceSection form={form} /> : null}
        {section === "creative" ? (
          <CreativeSection
            form={form}
            dealer={dealer}
            onSaved={onSaved}
            advancedOpen={creativeAdvancedOpen}
            onToggleAdvanced={() => setCreativeAdvancedOpen((open) => !open)}
          />
        ) : null}
        {section === "workflow" ? (
          <WorkflowSection
            form={form}
            dealerName={dealer.name}
            advancedOpen={advancedOpen}
            onToggleAdvanced={() => setAdvancedOpen((open) => !open)}
          />
        ) : null}

        {form.error && (
          <div
            role="alert"
            className="rounded-sm border border-error-ink/30 bg-error-fill px-3 py-2 text-sm text-error-ink"
          >
            {form.error}
          </div>
        )}

        <SettingsActionRow
          dirty={form.dirty}
          sectionsDirty={form.sectionsDirty}
          saving={form.saving}
          savedAt={form.savedAt}
          onSave={() => void form.handleSave()}
          onDiscard={() => setConfirmDiscard(true)}
        />
      </div>

      <SampleAside draft={form.draft} mark={mark} className="hidden lg:flex" />

      <DiscardSettingsDialog
        isOpen={confirmDiscard}
        onKeep={() => setConfirmDiscard(false)}
        onDiscard={() => {
          setConfirmDiscard(false);
          onDiscarded();
        }}
      />
    </div>
  );
};

// ----------------------------------------------------------------------------
// Team card — proper salespeople CRUD against the new salespeople collection.
// Listed members are deduped against the post log so the GSM can see who has
// generated posts even if they haven't been added to the formal roster yet.
// ----------------------------------------------------------------------------
export const DealerTeamCard: React.FC = () => {
  const [roster, setRoster] = useState<
    Array<{
      id?: string;
      name: string;
      hasPin?: boolean;
      pinNeedsDistribution?: boolean;
      active: boolean;
      count: number;
      lastAt?: string;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [oneTimeCode, setOneTimeCode] = useState<{
    id: string;
    name: string;
    pin: string;
  } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const dealer = useAppStore((s) => s.currentDealer);
  const role = useAppStore((s) => s.role);

  const load = React.useCallback(async () => {
    if (!dealer) return;
    setLoading(true);
    setError(null);
    try {
      const [sp, postsRes] = await Promise.all([
        import("../services/salespeople").then((m) => m.listSalespeople(true)),
        getLeaderboard(dealer.id, new Date(Date.UTC(2000, 0, 1))),
      ]);
      const counts = new Map<string, { count: number; lastAt: string }>();
      const looseNames = new Map<string, { count: number; lastAt: string }>();
      for (const p of postsRes) {
        const stamp = p.lastPostedAt;
        if (p.salespersonId) {
          const cur = counts.get(p.salespersonId) || { count: 0, lastAt: stamp };
          cur.count += p.count;
          if (stamp > cur.lastAt) cur.lastAt = stamp;
          counts.set(p.salespersonId, cur);
        } else if (p.salesperson) {
          const key = p.salesperson.trim();
          if (!key) continue;
          const cur = looseNames.get(key) || { count: 0, lastAt: stamp };
          cur.count += p.count;
          if (stamp > cur.lastAt) cur.lastAt = stamp;
          looseNames.set(key, cur);
        }
      }

      const rosterRows = sp.map((p) => ({
        id: p.id,
        name: p.name,
        hasPin: p.hasPin,
        pinNeedsDistribution: p.pinNeedsDistribution,
        active: p.active,
        count: counts.get(p.id)?.count || 0,
        lastAt: counts.get(p.id)?.lastAt,
      }));
      // Show "unrostered" names that have post activity but no salesperson record
      const rosteredNames = new Set(rosterRows.map((r) => r.name.toLowerCase()));
      const looseRows = Array.from(looseNames.entries())
        .filter(([n]) => !rosteredNames.has(n.toLowerCase()))
        .map(([name, v]) => ({
          name,
          active: true,
          count: v.count,
          lastAt: v.lastAt,
        }));

      const combined = [...rosterRows, ...looseRows].sort((a, b) => b.count - a.count);
      setRoster(combined);
    } catch (err) {
      setError(toUiMessage(err, "Could not load the team roster."));
    } finally {
      setLoading(false);
    }
  }, [dealer]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async () => {
    setError(null);
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const m = await import("../services/salespeople");
      const created = await m.addSalesperson({
        name: newName.trim(),
        role: "salesperson",
      });
      setNewName("");
      if (created.pin) {
        setError(null);
        setCodeCopied(false);
        setOneTimeCode({
          id: created.person.id,
          name: created.person.name,
          pin: created.pin,
        });
      }
      await load();
    } catch (err) {
      setError(toUiMessage(err, "Could not add this teammate."));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    try {
      const m = await import("../services/salespeople");
      await m.updateSalesperson(id, { active: !active });
      await load();
    } catch (err) {
      setError(toUiMessage(err, "Could not update this teammate."));
    }
  };

  const handlePromoteLoose = async (name: string) => {
    setSaving(true);
    try {
      const m = await import("../services/salespeople");
      const created = await m.addSalesperson({ name, role: "salesperson" });
      setCodeCopied(false);
      setOneTimeCode({
        id: created.person.id,
        name: created.person.name,
        pin: created.pin,
      });
      await load();
    } catch (err) {
      setError(toUiMessage(err, "Could not add this teammate."));
    } finally {
      setSaving(false);
    }
  };

  const handlePersonCommitted = React.useCallback((updated: Person) => {
    setRoster((current) =>
      current.map((person) =>
        person.id === updated.id
          ? {
              ...person,
              name: updated.name,
              active: updated.active,
              hasPin: updated.hasPin,
              pinNeedsDistribution: updated.pinNeedsDistribution,
            }
          : person,
      ),
    );
    setEditingPerson((current) =>
      current?.id === updated.id ? { ...current, ...updated } : current,
    );
    if (!updated.pinNeedsDistribution) {
      setOneTimeCode((current) => (current?.id === updated.id ? null : current));
    }
  }, []);

  const handleCredentialIssued = React.useCallback((credential: CredentialResult) => {
    setCodeCopied(false);
    setOneTimeCode({
      id: credential.person.id,
      name: credential.person.name,
      pin: credential.pin,
    });
  }, []);

  const handleCopyOneTimeCode = async () => {
    if (!oneTimeCode) return;
    try {
      await navigator.clipboard.writeText(oneTimeCode.pin);
      setCodeCopied(true);
    } catch {
      setError("Could not copy the code. Write it down before marking it shared.");
    }
  };

  const handleAcknowledgeOneTimeCode = async () => {
    if (!oneTimeCode || codeBusy) return;
    setCodeBusy(true);
    setError(null);
    try {
      const m = await import("../services/salespeople");
      const updated = await m.acknowledgePinDistribution(oneTimeCode.id);
      handlePersonCommitted(updated);
      setOneTimeCode(null);
    } catch (err) {
      setError(toUiMessage(err, "Could not mark the code as shared."));
    } finally {
      setCodeBusy(false);
    }
  };

  return (
    <div className="space-y-6 rounded-md border border-hairline bg-panel p-5 sm:p-6">
      <div>
        <h3 className="text-ink">Your team</h3>
        <p className="mt-1 text-sm text-ink-2">
          Each salesperson gets a personal 4-digit code for sign-in and is tied to their
          posts automatically. Deactivate anyone who leaves — historical posts stay
          intact.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Input
            id="manager-add-salesperson"
            label="Add salesperson"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value.slice(0, 120))}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !newName.trim() || saving) return;
              event.preventDefault();
              void handleAdd();
            }}
            placeholder="e.g. Sarah Chen"
            fullWidth
          />
        </div>
        <Button
          variant="primary"
          size="md"
          className="w-full sm:w-auto"
          disabled={!newName.trim() || saving}
          loading={saving}
          onClick={handleAdd}
        >
          Add
        </Button>
      </div>

      {oneTimeCode && (
        <div
          className="rounded-md border border-warning-ink/30 bg-warning-fill p-4 text-sm text-ink"
          role="status"
          aria-label="Access code ready to share"
        >
          <div className="font-semibold text-ink">
            {oneTimeCode.name}&apos;s access code is ready
          </div>
          <p className="mt-1 text-ink-2">
            Copy this one-time access code and share it privately. This handoff stays
            here until you mark it as shared.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="flex min-h-11 flex-1 items-center justify-center rounded-sm border border-hairline bg-panel-raised px-3 font-display text-2xl tabular-nums tracking-[0.3em] text-ink">
              {oneTimeCode.pin}
            </span>
            <Button
              variant="secondary"
              size="md"
              disabled={codeBusy}
              leftIcon={
                codeCopied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )
              }
              onClick={() => void handleCopyOneTimeCode()}
            >
              {codeCopied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={codeBusy}
              loading={codeBusy}
              onClick={() => void handleAcknowledgeOneTimeCode()}
            >
              {codeBusy ? "Updating…" : "Mark as shared"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-sm border border-error-ink/30 bg-error-fill px-3 py-2 text-sm text-error-ink"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-ink-2">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Loading
          roster…
        </div>
      ) : roster.length === 0 ? (
        <div className="py-12 text-center text-sm text-ink-2">
          No one on the roster yet — add your first teammate above.
        </div>
      ) : (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {roster.map((p) => (
            <li
              key={p.id || `loose:${p.name}`}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className={cn("min-w-0", !p.active && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {p.name}
                  {!p.id && <Badge variant="neutral">Not on roster</Badge>}
                  {!p.active && p.id && <Badge variant="neutral">Inactive</Badge>}
                  {p.id &&
                    (p.pinNeedsDistribution ? (
                      <Badge variant="warning">Code to share</Badge>
                    ) : p.hasPin ? (
                      <Badge variant="success">Code set</Badge>
                    ) : (
                      <Badge variant="neutral">No code</Badge>
                    ))}
                </div>
                <div className="mt-0.5 text-caption text-ink-2">
                  {p.count > 0
                    ? `${p.count} post${p.count === 1 ? "" : "s"}${
                        p.lastAt
                          ? `, last on ${new Date(p.lastAt).toLocaleDateString()}`
                          : ""
                      }`
                    : "No posts yet"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {p.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingPerson({
                          id: p.id!,
                          dealer: dealer?.id || "",
                          name: p.name,
                          active: p.active,
                          role: "salesperson",
                          hasPin: Boolean(p.hasPin),
                          pinNeedsDistribution: Boolean(p.pinNeedsDistribution),
                          hasManagerLogin: false,
                        })
                      }
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-ink-2 transition-colors duration-120 ease-out hover:bg-fill-subtle hover:text-ink"
                      title="Edit profile"
                      aria-label={`Edit ${p.name}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <Button
                      type="button"
                      variant={p.active ? "ghost" : "secondary"}
                      size="md"
                      onClick={() => p.id && handleToggleActive(p.id, p.active)}
                      title={p.active ? "Deactivate" : "Reactivate"}
                    >
                      {p.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={() => handlePromoteLoose(p.name)}
                    disabled={saving}
                    title="Add this person to the formal roster"
                  >
                    Add to roster
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <PersonEditModal
        isOpen={!!editingPerson}
        person={editingPerson}
        storeName={dealer?.name}
        allowRoleEdit={false}
        allowManagerScopeEdit={role === "dealer_admin" || role === "super_admin"}
        onClose={() => setEditingPerson(null)}
        onCommitted={handlePersonCommitted}
        onCredentialIssued={handleCredentialIssued}
        onSaved={(updated) => {
          handlePersonCommitted(updated);
          setEditingPerson(null);
          void load();
        }}
      />
    </div>
  );
};
