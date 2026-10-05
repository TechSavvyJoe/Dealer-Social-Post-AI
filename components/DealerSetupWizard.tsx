import React, { useEffect, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { Check, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "./ui/Button";
import { Input, Textarea } from "./ui/Input";
import { Dealer, StyleOption } from "../types";
import { triggerHapticFeedback } from "../utils/haptics";
import { cn } from "../utils/classNames";
import { toUiMessage } from "../utils/errorMessages";
import { HoursPicker } from "./HoursPicker";
import {
  defaultWeekHours,
  parseHoursString,
  serializeHours,
  type WeekHours,
} from "../utils/hoursFormat";
import { normalizeDealerSocialProfileValue } from "../utils/socialAttribution";

interface DealerSetupWizardProps {
  dealer: Dealer;
  /** Called with form-data of changed fields. Returns the updated dealer. */
  onSave: (fields: Record<string, string | boolean>) => Promise<Dealer>;
  onDismiss?: () => void;
}

/**
 * Multi-step first-time setup. Renders when the dealer is missing key
 * customization (brand_voice + brand_color). The manager can jump to any
 * step; Finish setup POSTs every changed field in a single update, and only
 * a save that resolved shows the success state and dismisses the wizard.
 *
 * Why bother: a dealer who never sets brand_voice gets generic captions and
 * thinks the product is mediocre. A 90-second wizard at first login captures
 * the 3 pieces of context that 10x the output quality.
 */
type StepId =
  | "contact"
  | "social"
  | "voice"
  | "banned"
  | "color"
  | "hashtags"
  | "overlays"
  | "approval";

/**
 * The steps a manager can open. There is deliberately no "done" step here:
 * success is a state the wizard reaches after a save resolves, never a place
 * a manager can navigate to (a clickable "Ready" chip used to claim the store
 * was set up, then dismiss the wizard for good, without saving anything).
 */
const STEPS: Array<{ id: StepId; title: string }> = [
  { id: "contact", title: "Contact" },
  { id: "social", title: "Social" },
  { id: "voice", title: "Voice" },
  { id: "banned", title: "Banned" },
  { id: "color", title: "Color" },
  { id: "hashtags", title: "Hashtags" },
  { id: "overlays", title: "Overlays" },
  { id: "approval", title: "Approval" },
];

/**
 * The checklist counts what a manager has to fill in. Approval is a choice
 * with a safe default, not a task, so it never counts as done or undone.
 */
const SETUP_TASKS = STEPS.filter((item) => item.id !== "approval");

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const hasSavedText = (value?: string | null) => Boolean(value && value.trim());

/** Completion is read from the saved record, never from unsaved form state. */
const savedStepComplete = (dealer: Dealer, id: StepId): boolean => {
  switch (id) {
    case "contact":
      return (
        hasSavedText(dealer.website) &&
        hasSavedText(dealer.phone) &&
        hasSavedText(dealer.address)
      );
    case "social":
      return [
        dealer.facebook_url,
        dealer.facebook_page_tag,
        dealer.instagram_handle,
        dealer.tiktok_handle,
        dealer.x_handle,
        dealer.linkedin_company_tag,
        dealer.gbp_url,
      ].some(hasSavedText);
    case "voice":
      return hasSavedText(dealer.brand_voice);
    case "banned":
      return hasSavedText(dealer.banned_phrases);
    case "color":
      return HEX_RE.test((dealer.brand_color || "").trim());
    case "hashtags":
      return (
        hasSavedText(dealer.default_hashtags) || hasSavedText(dealer.default_footer)
      );
    case "overlays":
      return hasSavedText(dealer.enabled_styles) || hasSavedText(dealer.default_style);
    case "approval":
      return false;
  }
};

const parseEnabledStyles = (raw?: string): Set<string> => {
  const trimmed = (raw || "").trim();
  return trimmed
    ? new Set(
        trimmed
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : new Set<string>(Object.values(StyleOption)); // default: all enabled
};

export const DealerSetupWizard: React.FC<DealerSetupWizardProps> = ({
  dealer,
  onSave,
  onDismiss,
}) => {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];
  const [finished, setFinished] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Contact + identity
  const [website, setWebsite] = useState(dealer.website || "");
  const [phone, setPhone] = useState(dealer.phone || "");
  const [address, setAddress] = useState(dealer.address || "");
  const [hoursWeek, setHoursWeek] = useState<WeekHours>(
    () => parseHoursString(dealer.hours) || defaultWeekHours(),
  );
  const hours = serializeHours(hoursWeek);
  const [tagline, setTagline] = useState(dealer.tagline || "");

  // Social
  const [facebookUrl, setFacebookUrl] = useState(dealer.facebook_url || "");
  const [facebookPageTag, setFacebookPageTag] = useState(
    dealer.facebook_page_tag || "",
  );
  const [instagramHandle, setInstagramHandle] = useState(dealer.instagram_handle || "");
  const [tiktokHandle, setTiktokHandle] = useState(dealer.tiktok_handle || "");
  const [xHandle, setXHandle] = useState(dealer.x_handle || "");
  const [linkedinCompanyTag, setLinkedinCompanyTag] = useState(
    dealer.linkedin_company_tag || "",
  );
  const [gbpUrl, setGbpUrl] = useState(dealer.gbp_url || "");

  // Voice / banned / color (existing)
  const [voice, setVoice] = useState(dealer.brand_voice || "");
  const [banned, setBanned] = useState(dealer.banned_phrases || "");
  const [color, setColor] = useState(dealer.brand_color || "");

  // Generation defaults
  const [defaultHashtags, setDefaultHashtags] = useState(dealer.default_hashtags || "");
  const [defaultFooter, setDefaultFooter] = useState(dealer.default_footer || "");

  // Overlay preferences — parsed sets of enabled style ids
  const [enabledStyles, setEnabledStyles] = useState<Set<string>>(() =>
    parseEnabledStyles(dealer.enabled_styles),
  );
  const [defaultStyle, setDefaultStyle] = useState<string>(dealer.default_style || "");

  const [requiresApproval, setRequiresApproval] = useState(!!dealer.requires_approval);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The Settings tab can save while this wizard is open. Every field the
  // manager has not edited here follows the newly saved record, so Finish
  // setup never writes a stale value back over that save, and Later never
  // warns about entries that are already saved. A field edited here keeps
  // what was typed.
  const syncedDealer = useRef(dealer);
  useEffect(() => {
    const was = syncedDealer.current;
    if (was === dealer) return;
    syncedDealer.current = dealer;
    const follow = <T,>(
      set: React.Dispatch<React.SetStateAction<T>>,
      before: T,
      after: T,
      same: (a: T, b: T) => boolean = Object.is,
    ) => {
      if (same(before, after)) return;
      set((current) => (same(current, before) ? after : current));
    };
    const text = (
      set: React.Dispatch<React.SetStateAction<string>>,
      before?: string | null,
      after?: string | null,
    ) => follow(set, before || "", after || "");
    text(setWebsite, was.website, dealer.website);
    text(setPhone, was.phone, dealer.phone);
    text(setAddress, was.address, dealer.address);
    text(setTagline, was.tagline, dealer.tagline);
    text(setFacebookUrl, was.facebook_url, dealer.facebook_url);
    text(setFacebookPageTag, was.facebook_page_tag, dealer.facebook_page_tag);
    text(setInstagramHandle, was.instagram_handle, dealer.instagram_handle);
    text(setTiktokHandle, was.tiktok_handle, dealer.tiktok_handle);
    text(setXHandle, was.x_handle, dealer.x_handle);
    text(setLinkedinCompanyTag, was.linkedin_company_tag, dealer.linkedin_company_tag);
    text(setGbpUrl, was.gbp_url, dealer.gbp_url);
    text(setVoice, was.brand_voice, dealer.brand_voice);
    text(setBanned, was.banned_phrases, dealer.banned_phrases);
    text(setColor, was.brand_color, dealer.brand_color);
    text(setDefaultHashtags, was.default_hashtags, dealer.default_hashtags);
    text(setDefaultFooter, was.default_footer, dealer.default_footer);
    text(setDefaultStyle, was.default_style, dealer.default_style);
    follow(
      setHoursWeek,
      parseHoursString(was.hours) || defaultWeekHours(),
      parseHoursString(dealer.hours) || defaultWeekHours(),
      (a, b) => serializeHours(a) === serializeHours(b),
    );
    follow(
      setEnabledStyles,
      parseEnabledStyles(was.enabled_styles),
      parseEnabledStyles(dealer.enabled_styles),
      (a, b) => Array.from(a).sort().join(",") === Array.from(b).sort().join(","),
    );
    follow(setRequiresApproval, !!was.requires_approval, !!dealer.requires_approval);
  }, [dealer]);

  const toggleStyle = (id: string) => {
    setEnabledStyles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // If we just disabled the default, clear it
        if (defaultStyle === id) setDefaultStyle("");
      } else {
        next.add(id);
      }
      // Never let them disable everything
      if (next.size === 0) next.add(id);
      return next;
    });
  };

  const next = () => setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  const prev = () => setStepIdx((i) => Math.max(0, i - 1));

  /**
   * Every field that differs from a baseline. Saving compares hours and
   * overlay styles against the raw stored columns, so a first save persists
   * the derived defaults (a full week, every style). The "anything typed?"
   * check compares against those same derived defaults instead, so an
   * untouched wizard never reads as unsaved work.
   */
  const buildFields = (baseline: "stored" | "derived") => {
    const diff = <T extends string | boolean>(key: string, next: T, prev: T) =>
      next !== prev ? { [key]: next } : {};
    const savedHours =
      baseline === "derived"
        ? serializeHours(parseHoursString(dealer.hours) || defaultWeekHours())
        : dealer.hours || "";
    const savedStyles =
      baseline === "derived"
        ? Array.from(parseEnabledStyles(dealer.enabled_styles)).join(",")
        : dealer.enabled_styles || "";
    const fields: Record<string, string | boolean> = {
      ...diff("brand_voice", voice.trim(), dealer.brand_voice || ""),
      ...diff("banned_phrases", banned.trim(), dealer.banned_phrases || ""),
      ...diff("brand_color", color.trim(), dealer.brand_color || ""),
      ...diff("website", website.trim(), dealer.website || ""),
      ...diff("phone", phone.trim(), dealer.phone || ""),
      ...diff("address", address.trim(), dealer.address || ""),
      ...diff("hours", hours.trim(), savedHours),
      ...diff("tagline", tagline.trim(), dealer.tagline || ""),
      ...diff("facebook_url", facebookUrl.trim(), dealer.facebook_url || ""),
      ...diff(
        "facebook_page_tag",
        normalizeDealerSocialProfileValue("facebook_page_tag", facebookPageTag),
        normalizeDealerSocialProfileValue(
          "facebook_page_tag",
          dealer.facebook_page_tag,
        ),
      ),
      ...diff(
        "instagram_handle",
        normalizeDealerSocialProfileValue("instagram_handle", instagramHandle),
        normalizeDealerSocialProfileValue("instagram_handle", dealer.instagram_handle),
      ),
      ...diff(
        "tiktok_handle",
        normalizeDealerSocialProfileValue("tiktok_handle", tiktokHandle),
        normalizeDealerSocialProfileValue("tiktok_handle", dealer.tiktok_handle),
      ),
      ...diff(
        "x_handle",
        normalizeDealerSocialProfileValue("x_handle", xHandle),
        normalizeDealerSocialProfileValue("x_handle", dealer.x_handle),
      ),
      ...diff(
        "linkedin_company_tag",
        normalizeDealerSocialProfileValue("linkedin_company_tag", linkedinCompanyTag),
        normalizeDealerSocialProfileValue(
          "linkedin_company_tag",
          dealer.linkedin_company_tag,
        ),
      ),
      ...diff("gbp_url", gbpUrl.trim(), dealer.gbp_url || ""),
      ...diff(
        "default_hashtags",
        defaultHashtags.trim(),
        dealer.default_hashtags || "",
      ),
      ...diff("default_footer", defaultFooter.trim(), dealer.default_footer || ""),
      ...diff("enabled_styles", Array.from(enabledStyles).join(","), savedStyles),
      ...diff("default_style", defaultStyle, dealer.default_style || ""),
    };
    if (requiresApproval !== !!dealer.requires_approval) {
      fields.requires_approval = requiresApproval;
      // "Manager approves first" means every post. Clear any stored narrowing
      // (the server applies approval_policy only while approval is on) so the
      // choice made here is exactly what the server enforces.
      if (requiresApproval) fields.approval_policy = "";
    }
    return fields;
  };

  const hasUnsavedEntries = Object.keys(buildFields("derived")).length > 0;

  const handleFinish = async () => {
    setError(null);
    if (color && !HEX_RE.test(color.trim())) {
      setError("Brand color should be a hex value like #1d4ed8.");
      return;
    }
    const fields = buildFields("stored");
    const nothingToSave = Object.keys(fields).length === 0;
    // "<dealer> is set up" is claimed only after a save, or for a store that
    // already has its voice and colour saved. Otherwise there is nothing true
    // to report, and the wizard must not dismiss itself for good.
    if (nothingToSave) {
      const missing = [
        !savedStepComplete(dealer, "voice") && "brand voice",
        !savedStepComplete(dealer, "color") && "brand color",
      ].filter(Boolean);
      if (missing.length > 0) {
        setError(
          `Nothing to save yet. Add your ${missing.join(" and ")}, or choose Later to finish another time.`,
        );
        return;
      }
    }
    setSaving(true);
    try {
      if (!nothingToSave) {
        await onSave(fields);
      }
      triggerHapticFeedback();
      setFinished(true);
    } catch (err) {
      setError(toUiMessage(err, "Could not save your setup."));
    } finally {
      setSaving(false);
    }
  };

  // Auto-dismiss only after a save has resolved and the success state shows.
  useEffect(() => {
    if (finished && onDismiss) {
      const t = window.setTimeout(onDismiss, 1800);
      return () => window.clearTimeout(t);
    }
  }, [finished, onDismiss]);

  const handleLater = () => {
    if (!onDismiss) return;
    if (hasUnsavedEntries && !confirmLeave) {
      setConfirmLeave(true);
      return;
    }
    onDismiss();
  };

  const completedSteps = SETUP_TASKS.filter((item) =>
    savedStepComplete(dealer, item.id),
  ).length;

  return (
    <section
      aria-labelledby="dealer-setup-heading"
      className="space-y-5 rounded-md border border-hairline bg-panel p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id="dealer-setup-heading" className="text-ink">
            Set up {dealer.name}
          </h3>
          <p className="mt-1 text-sm text-ink-2">
            90 seconds to make every post sound like your dealership instead of generic
            AI.
          </p>
        </div>
        {onDismiss && !finished && (
          <Button variant="ghost" size="md" onClick={handleLater}>
            Later
          </Button>
        )}
      </div>

      {confirmLeave && !finished ? (
        <div
          role="alert"
          className="space-y-3 rounded-sm border border-warning-ink/30 bg-warning-fill px-3 py-3"
        >
          <p className="text-sm text-warning-ink">
            What you entered here has not been saved. Leave setup anyway?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setConfirmLeave(false)}
            >
              Keep setting up
            </Button>
            <Button variant="ghost" size="md" onClick={() => onDismiss?.()}>
              Leave without saving
            </Button>
          </div>
        </div>
      ) : null}

      {finished ? (
        <div
          className="flex flex-col items-center gap-3 py-8 text-center"
          role="status"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success-fill">
            <Check className="h-7 w-7 text-success-ink" aria-hidden="true" />
          </div>
          <div className="text-lg font-semibold text-ink">{dealer.name} is set up</div>
          <div className="text-sm text-ink-2">
            You can change any of this later in Dealership settings.
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-ink">Setup checklist</div>
              <div className="text-caption text-ink-2">
                {completedSteps} of {SETUP_TASKS.length} complete. Pick any step.
              </div>
            </div>
            <div
              className="h-1 w-24 overflow-hidden rounded-full bg-panel-raised"
              role="progressbar"
              aria-label="Setup progress"
              aria-valuemin={0}
              aria-valuemax={SETUP_TASKS.length}
              aria-valuenow={completedSteps}
            >
              <div
                className="h-full bg-brand-fill"
                style={{ width: `${(completedSteps / SETUP_TASKS.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Compact, clickable step indicator: only the real steps. */}
          <nav
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            aria-label="Setup steps"
          >
            {STEPS.map((s, i) => {
              const active = i === stepIdx;
              const done = savedStepComplete(dealer, s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-current={active ? "step" : undefined}
                  onClick={() => setStepIdx(i)}
                  className={cn(
                    "flex min-h-11 items-center justify-between gap-2 rounded-sm border px-3 text-left text-sm font-medium transition-colors duration-120 ease-out",
                    active
                      ? "border-brand-ink bg-brand-tint text-ink"
                      : "border-hairline bg-panel-raised text-ink-2 hover:border-strong",
                  )}
                >
                  {s.title}
                  {done ? (
                    <>
                      <Check
                        className="h-4 w-4 shrink-0 text-success-ink"
                        aria-hidden="true"
                      />
                      <span className="sr-only">, complete</span>
                    </>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <AnimatePresence mode="wait" initial={false}>
            <m.div
              key={step.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="min-h-[140px]"
            >
              {step.id === "contact" && (
                <div className="space-y-4">
                  <p className="text-sm text-ink-2">
                    Contact info shown in posts, on receipts, and in your dashboard.
                    None of it is required — set whatever you want surfaced.
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                      label="Website"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://yourdealership.com"
                      fullWidth
                    />
                    <Input
                      label="Phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(313) 555-0100"
                      fullWidth
                    />
                  </div>
                  <Input
                    label="Address (one line)"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Main St, Detroit MI 48201"
                    fullWidth
                  />
                  <HoursPicker
                    value={hoursWeek}
                    onChange={setHoursWeek}
                    preview={hours}
                  />
                  <Input
                    label="Tagline"
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    placeholder="Family-owned since 1985 · No-haggle pricing"
                    fullWidth
                  />
                </div>
              )}

              {step.id === "social" && (
                <div className="space-y-4">
                  <p className="text-sm text-ink-2">
                    Where your team posts. Sharing uses these to open the right account.
                  </p>
                  <Input
                    label="Facebook page URL"
                    value={facebookUrl}
                    onChange={(e) => setFacebookUrl(e.target.value)}
                    placeholder="https://www.facebook.com/yourdealership"
                    fullWidth
                  />
                  <Input
                    label="Facebook Page tag"
                    value={facebookPageTag}
                    onChange={(e) => setFacebookPageTag(e.target.value)}
                    placeholder="@Your Dealership"
                    helperText="Added to Facebook and Marketplace captions. Tap Facebook's Page suggestion if it appears."
                    fullWidth
                  />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                      label="Instagram"
                      value={instagramHandle}
                      onChange={(e) => setInstagramHandle(e.target.value)}
                      placeholder="@yourdealership"
                      fullWidth
                    />
                    <Input
                      label="TikTok"
                      value={tiktokHandle}
                      onChange={(e) => setTiktokHandle(e.target.value)}
                      placeholder="@yourdealership"
                      fullWidth
                    />
                    <Input
                      label="X / Twitter"
                      value={xHandle}
                      onChange={(e) => setXHandle(e.target.value)}
                      placeholder="@yourdealership"
                      fullWidth
                    />
                    <Input
                      label="LinkedIn company tag"
                      value={linkedinCompanyTag}
                      onChange={(e) => setLinkedinCompanyTag(e.target.value)}
                      placeholder="@your-company"
                      helperText="LinkedIn may ask you to select the company suggestion once."
                      fullWidth
                    />
                  </div>
                  <Input
                    label="Google Business Profile URL"
                    value={gbpUrl}
                    onChange={(e) => setGbpUrl(e.target.value)}
                    placeholder="https://g.page/yourdealership"
                    fullWidth
                  />
                </div>
              )}

              {step.id === "hashtags" && (
                <div className="space-y-4">
                  <p className="text-sm text-ink-2">
                    Hashtags and a CTA the AI will weave into every post. One hashtag
                    per line. Footer is appended after the caption (e.g. "Stop by 123
                    Main St — open until 9pm").
                  </p>
                  <Textarea
                    label="Default hashtags"
                    value={defaultHashtags}
                    onChange={(e) => setDefaultHashtags(e.target.value)}
                    rows={3}
                    placeholder={"#YourDealership\n#DetroitFord\n#NewRide"}
                    fullWidth
                  />
                  <Textarea
                    label="Default footer / CTA"
                    value={defaultFooter}
                    onChange={(e) => setDefaultFooter(e.target.value)}
                    rows={2}
                    placeholder="Stop by 123 Main St — open until 9pm. Call us at (313) 555-0100."
                    fullWidth
                  />
                </div>
              )}

              {step.id === "overlays" && (
                <div className="space-y-4">
                  <p className="text-sm text-ink-2">
                    Pick which design styles your team can use. Anything you disable
                    disappears from the salesperson picker. The default style is
                    preselected when they open the customizer.
                  </p>
                  <ul className="divide-y divide-hairline rounded-md border border-hairline bg-panel">
                    {Object.values(StyleOption).map((s) => {
                      const enabled = enabledStyles.has(s);
                      const isDefault = defaultStyle === s;
                      return (
                        <li
                          key={s}
                          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"
                        >
                          <div className={cn("min-w-0", !enabled && "opacity-60")}>
                            <div className="text-sm font-semibold text-ink">{s}</div>
                            <div className="text-caption text-ink-2">
                              {enabled ? "available to salespeople" : "hidden"}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              type="button"
                              variant={isDefault ? "secondary" : "ghost"}
                              size="md"
                              aria-pressed={isDefault}
                              disabled={!enabled}
                              onClick={() => setDefaultStyle(isDefault ? "" : s)}
                              title={
                                isDefault
                                  ? "This is the default — tap to unset"
                                  : "Mark as default"
                              }
                            >
                              {isDefault ? "Default" : "Set default"}
                            </Button>
                            <Button
                              type="button"
                              variant={enabled ? "ghost" : "secondary"}
                              size="md"
                              onClick={() => toggleStyle(s)}
                            >
                              {enabled ? "Disable" : "Enable"}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-caption text-ink-2">
                    Playful styles can be set later in Dealership settings.
                  </p>
                </div>
              )}

              {step.id === "voice" && (
                <div className="space-y-3">
                  <p className="text-sm text-ink-2">
                    Tell the AI how your dealership sounds. The more specific, the less
                    generic the captions.
                  </p>
                  <Textarea
                    label="Brand voice"
                    value={voice}
                    onChange={(e) => setVoice(e.target.value)}
                    placeholder={`e.g. "Confident, no exclamation points, never use 'family-owned'. Lead with the customer, not the car. Local Detroit references are good."`}
                    rows={4}
                    fullWidth
                  />
                  <p className="text-caption text-ink-2">
                    Examples that work: tone words ("warm, no hype"), forbidden clichés
                    ("don't say 'amazing deal'"), local color ("we're a Detroit shop —
                    Tigers, Lions, never Buckeyes").
                  </p>
                </div>
              )}

              {step.id === "banned" && (
                <div className="space-y-3">
                  <p className="text-sm text-ink-2">
                    Phrases the AI must never use. One per line or comma-separated.
                  </p>
                  <Textarea
                    label="Banned phrases"
                    value={banned}
                    onChange={(e) => setBanned(e.target.value)}
                    placeholder={`guaranteed approval\nno credit check\nlowest price guaranteed\nbest deal in town`}
                    rows={4}
                    fullWidth
                  />
                  <p className="text-caption text-ink-2">
                    FTC + most OEM brand standards prohibit "guaranteed approval", "no
                    credit check", "lowest price guaranteed". Use the examples above as
                    a starting point.
                  </p>
                </div>
              )}

              {step.id === "color" && (
                <div className="space-y-3">
                  <p className="text-sm text-ink-2">
                    Your dealership's primary brand color. Used for the main action
                    buttons across the app.
                  </p>
                  <div className="flex items-end gap-3">
                    <input
                      type="color"
                      value={HEX_RE.test(color) ? color : "#1d4ed8"}
                      onChange={(e) => setColor(e.target.value)}
                      className="h-11 w-16 shrink-0 cursor-pointer rounded-sm border border-strong bg-transparent"
                      aria-label="Pick brand color"
                    />
                    <Input
                      label="Hex value"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      placeholder="#1d4ed8"
                      fullWidth
                    />
                  </div>
                </div>
              )}

              {step.id === "approval" && (
                <div className="space-y-4">
                  <p className="text-sm text-ink-2">
                    Should a manager approve every post before a salesperson can share
                    it? You can change this anytime in Dealership settings, including
                    reviewing only some posts.
                  </p>
                  <div
                    className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                    role="group"
                    aria-label="Manager approval"
                  >
                    <button
                      type="button"
                      aria-pressed={!requiresApproval}
                      onClick={() => setRequiresApproval(false)}
                      className={cn(
                        "rounded-sm border p-3 text-left text-sm transition-colors duration-120 ease-out",
                        !requiresApproval
                          ? "border-brand-ink bg-brand-tint text-ink"
                          : "border-hairline bg-panel text-ink hover:border-strong",
                      )}
                    >
                      <div className="font-semibold">No review needed</div>
                      <div className="mt-1 text-caption text-ink-2">
                        Faster. Salespeople share as soon as a post is ready. Best when
                        the team is experienced.
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-pressed={requiresApproval}
                      onClick={() => setRequiresApproval(true)}
                      className={cn(
                        "rounded-sm border p-3 text-left text-sm transition-colors duration-120 ease-out",
                        requiresApproval
                          ? "border-brand-ink bg-brand-tint text-ink"
                          : "border-hairline bg-panel text-ink hover:border-strong",
                      )}
                    >
                      <div className="font-semibold">Manager approves first</div>
                      <div className="mt-1 text-caption text-ink-2">
                        Safer. A manager approves every post before it can be shared.
                        Recommended for new teams.
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </m.div>
          </AnimatePresence>

          {error && (
            <div
              role="alert"
              className="rounded-sm border border-error-ink/30 bg-error-fill px-3 py-2 text-sm text-error-ink"
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-hairline pt-4">
            <Button
              variant="ghost"
              size="md"
              leftIcon={<ChevronLeft className="h-4 w-4" />}
              onClick={prev}
              disabled={stepIdx === 0 || saving}
            >
              Back
            </Button>
            {stepIdx < STEPS.length - 1 ? (
              <Button
                variant="primary"
                size="md"
                rightIcon={<ChevronRight className="h-4 w-4" />}
                onClick={next}
                disabled={saving}
              >
                Next
              </Button>
            ) : (
              <Button
                variant="primary"
                size="md"
                loading={saving}
                onClick={handleFinish}
                disabled={saving}
              >
                {saving ? "Saving…" : "Finish setup"}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
};
