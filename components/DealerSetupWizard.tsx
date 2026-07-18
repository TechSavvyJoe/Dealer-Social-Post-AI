import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Palette,
  Ban,
  Trophy,
  Check,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Building2,
  Wand2,
  Phone,
  Hash,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input, Textarea } from "./ui/Input";
import { Dealer, StyleOption } from "../types";
import { triggerHapticFeedback } from "../utils/haptics";
import { cn } from "../utils/classNames";
import { HoursPicker } from "./HoursPicker";
import {
  defaultWeekHours,
  parseHoursString,
  serializeHours,
  type WeekHours,
} from "../utils/hoursFormat";

interface DealerSetupWizardProps {
  dealer: Dealer;
  /** Called with form-data of changed fields. Returns the updated dealer. */
  onSave: (fields: Record<string, string | boolean>) => Promise<Dealer>;
  onDismiss?: () => void;
}

/**
 * Multi-step first-time setup. Renders when the dealer is missing key
 * customization (brand_voice + brand_color). Each step has its own validation
 * and the user can skip ahead. On the last step we POST all of the new fields
 * in a single update and dismiss.
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
  | "approval"
  | "done";

const STEPS: Array<{ id: StepId; title: string; icon: typeof Sparkles }> = [
  { id: "contact", title: "Contact", icon: Phone },
  { id: "social", title: "Social", icon: Hash },
  { id: "voice", title: "Voice", icon: Wand2 },
  { id: "banned", title: "Banned", icon: Ban },
  { id: "color", title: "Color", icon: Palette },
  { id: "hashtags", title: "Hashtags", icon: Hash },
  { id: "overlays", title: "Overlays", icon: ImageIcon },
  { id: "approval", title: "Approval", icon: Trophy },
  { id: "done", title: "Ready", icon: Check },
];

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const DealerSetupWizard: React.FC<DealerSetupWizardProps> = ({
  dealer,
  onSave,
  onDismiss,
}) => {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

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
  const [instagramHandle, setInstagramHandle] = useState(dealer.instagram_handle || "");
  const [tiktokHandle, setTiktokHandle] = useState(dealer.tiktok_handle || "");
  const [xHandle, setXHandle] = useState(dealer.x_handle || "");
  const [gbpUrl, setGbpUrl] = useState(dealer.gbp_url || "");

  // Voice / banned / color (existing)
  const [voice, setVoice] = useState(dealer.brand_voice || "");
  const [banned, setBanned] = useState(dealer.banned_phrases || "");
  const [color, setColor] = useState(dealer.brand_color || "");

  // Generation defaults
  const [defaultHashtags, setDefaultHashtags] = useState(dealer.default_hashtags || "");
  const [defaultFooter, setDefaultFooter] = useState(dealer.default_footer || "");

  // Overlay preferences — parsed sets of enabled style ids
  const initialEnabledStyles = (() => {
    const raw = (dealer.enabled_styles || "").trim();
    return raw
      ? new Set(
          raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        )
      : new Set<string>(Object.values(StyleOption)); // default: all enabled
  })();
  const [enabledStyles, setEnabledStyles] = useState<Set<string>>(initialEnabledStyles);
  const [defaultStyle, setDefaultStyle] = useState<string>(dealer.default_style || "");

  const [requiresApproval, setRequiresApproval] = useState(!!dealer.requires_approval);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleFinish = async () => {
    setError(null);
    if (color && !HEX_RE.test(color.trim())) {
      setError("Brand color should be a hex value like #1d4ed8.");
      return;
    }
    setSaving(true);
    try {
      const diff = <T extends string | boolean>(key: string, next: T, prev: T) =>
        next !== prev ? { [key]: next } : {};
      const fields: Record<string, string | boolean> = {
        ...diff("brand_voice", voice.trim(), dealer.brand_voice || ""),
        ...diff("banned_phrases", banned.trim(), dealer.banned_phrases || ""),
        ...diff("brand_color", color.trim(), dealer.brand_color || ""),
        ...diff("website", website.trim(), dealer.website || ""),
        ...diff("phone", phone.trim(), dealer.phone || ""),
        ...diff("address", address.trim(), dealer.address || ""),
        ...diff("hours", hours.trim(), dealer.hours || ""),
        ...diff("tagline", tagline.trim(), dealer.tagline || ""),
        ...diff("facebook_url", facebookUrl.trim(), dealer.facebook_url || ""),
        ...diff(
          "instagram_handle",
          instagramHandle.trim().replace(/^@/, ""),
          (dealer.instagram_handle || "").replace(/^@/, ""),
        ),
        ...diff(
          "tiktok_handle",
          tiktokHandle.trim().replace(/^@/, ""),
          (dealer.tiktok_handle || "").replace(/^@/, ""),
        ),
        ...diff(
          "x_handle",
          xHandle.trim().replace(/^@/, ""),
          (dealer.x_handle || "").replace(/^@/, ""),
        ),
        ...diff("gbp_url", gbpUrl.trim(), dealer.gbp_url || ""),
        ...diff(
          "default_hashtags",
          defaultHashtags.trim(),
          dealer.default_hashtags || "",
        ),
        ...diff("default_footer", defaultFooter.trim(), dealer.default_footer || ""),
        ...diff(
          "enabled_styles",
          Array.from(enabledStyles).join(","),
          dealer.enabled_styles || "",
        ),
        ...diff("default_style", defaultStyle, dealer.default_style || ""),
      };
      if (requiresApproval !== !!dealer.requires_approval) {
        fields.requires_approval = requiresApproval;
      }
      if (Object.keys(fields).length > 0) {
        await onSave(fields);
      }
      triggerHapticFeedback();
      setStepIdx(STEPS.length - 1); // "done"
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // Auto-dismiss after the "done" step has been visible for a moment
  useEffect(() => {
    if (step.id === "done" && onDismiss) {
      const t = window.setTimeout(onDismiss, 1800);
      return () => window.clearTimeout(t);
    }
  }, [step.id, onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/5 border border-primary-500/30 rounded-2xl p-4 sm:p-6 space-y-4"
    >
      <div className="flex items-center gap-3">
        <div
          className="h-8 w-1.5 rounded-full"
          style={{
            background:
              "linear-gradient(180deg, var(--brand-primary-400), var(--brand-primary))",
          }}
          aria-hidden="true"
        />
        <div className="flex-1">
          <h3 className="text-xl font-bold text-surface-50 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary-300" />
            Set up {dealer.name}
          </h3>
          <p className="text-xs text-surface-400">
            90 seconds to make every post sound like your dealership instead of generic
            AI.
          </p>
        </div>
        {onDismiss && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className="text-surface-400 hover:text-surface-200"
          >
            Later
          </Button>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = i === stepIdx;
          const done = i < stepIdx;
          return (
            <div key={s.id} className="flex items-center flex-1">
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] flex-shrink-0",
                  active && "bg-primary-500/20 text-primary-100",
                  done && "text-success-200",
                  !active && !done && "text-surface-500",
                )}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden sm:inline">{s.title}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "h-px flex-1 mx-1",
                    done ? "bg-success-400/50" : "bg-white/10",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.2 }}
          className="min-h-[140px]"
        >
          {step.id === "contact" && (
            <div className="space-y-3">
              <p className="text-sm text-surface-200">
                Contact info shown in posts, on receipts, and in your dashboard. None of
                it is required — set whatever you want surfaced.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  label="Website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://yourdealership.com"
                  fullWidth
                  className="bg-white/5 border-white/10 focus:border-primary-400"
                />
                <Input
                  label="Phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(313) 555-0100"
                  fullWidth
                  className="bg-white/5 border-white/10 focus:border-primary-400"
                />
              </div>
              <Input
                label="Address (one line)"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St, Detroit MI 48201"
                fullWidth
                className="bg-white/5 border-white/10 focus:border-primary-400"
              />
              <HoursPicker value={hoursWeek} onChange={setHoursWeek} preview={hours} />
              <Input
                label="Tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Family-owned since 1985 · No-haggle pricing"
                fullWidth
                className="bg-white/5 border-white/10 focus:border-primary-400"
              />
            </div>
          )}

          {step.id === "social" && (
            <div className="space-y-3">
              <p className="text-sm text-surface-200">
                Where you post. The Share dialog uses these to deep-link into the right
                account when you publish.
              </p>
              <Input
                label="Facebook page URL"
                value={facebookUrl}
                onChange={(e) => setFacebookUrl(e.target.value)}
                placeholder="https://www.facebook.com/yourdealership"
                fullWidth
                className="bg-white/5 border-white/10 focus:border-primary-400"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input
                  label="Instagram"
                  value={instagramHandle}
                  onChange={(e) => setInstagramHandle(e.target.value)}
                  placeholder="@yourdealership"
                  fullWidth
                  className="bg-white/5 border-white/10 focus:border-primary-400"
                />
                <Input
                  label="TikTok"
                  value={tiktokHandle}
                  onChange={(e) => setTiktokHandle(e.target.value)}
                  placeholder="@yourdealership"
                  fullWidth
                  className="bg-white/5 border-white/10 focus:border-primary-400"
                />
                <Input
                  label="X / Twitter"
                  value={xHandle}
                  onChange={(e) => setXHandle(e.target.value)}
                  placeholder="@yourdealership"
                  fullWidth
                  className="bg-white/5 border-white/10 focus:border-primary-400"
                />
              </div>
              <Input
                label="Google Business Profile URL"
                value={gbpUrl}
                onChange={(e) => setGbpUrl(e.target.value)}
                placeholder="https://g.page/yourdealership"
                fullWidth
                className="bg-white/5 border-white/10 focus:border-primary-400"
              />
            </div>
          )}

          {step.id === "hashtags" && (
            <div className="space-y-3">
              <p className="text-sm text-surface-200">
                Hashtags and a CTA the AI will weave into every post. One hashtag per
                line. Footer is appended after the caption (e.g. "Stop by 123 Main St —
                open until 9pm").
              </p>
              <Textarea
                label="Default hashtags"
                value={defaultHashtags}
                onChange={(e) => setDefaultHashtags(e.target.value)}
                rows={3}
                placeholder={"#YourDealership\n#DetroitFord\n#NewRide"}
                fullWidth
                className="bg-white/5 border-white/10 focus:border-primary-400 font-mono text-sm"
              />
              <Textarea
                label="Default footer / CTA"
                value={defaultFooter}
                onChange={(e) => setDefaultFooter(e.target.value)}
                rows={2}
                placeholder="Stop by 123 Main St — open until 9pm. Call us at (313) 555-0100."
                fullWidth
                className="bg-white/5 border-white/10 focus:border-primary-400"
              />
            </div>
          )}

          {step.id === "overlays" && (
            <div className="space-y-3">
              <p className="text-sm text-surface-200">
                Pick which design styles your team can use. Anything you disable
                disappears from the salesperson picker. The starred style is preselected
                when they open the customizer.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.values(StyleOption).map((s) => {
                  const enabled = enabledStyles.has(s);
                  const isDefault = defaultStyle === s;
                  return (
                    <div
                      key={s}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 flex items-center justify-between gap-2",
                        enabled
                          ? "border-primary-500/40 bg-primary-500/5"
                          : "border-white/10 bg-white/5 opacity-60",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-surface-50">{s}</div>
                        <div className="text-[10px] text-surface-400">
                          {enabled ? "available to salespeople" : "hidden"}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={!enabled}
                          onClick={() => setDefaultStyle(isDefault ? "" : s)}
                          className={cn(
                            "text-[10px] px-2 py-1 rounded-md transition-colors",
                            isDefault
                              ? "bg-amber-500/30 text-amber-100"
                              : "bg-white/5 hover:bg-white/10 text-surface-300",
                            !enabled && "opacity-30 cursor-not-allowed",
                          )}
                          title={
                            isDefault
                              ? "This is the default — tap to unset"
                              : "Mark as default"
                          }
                        >
                          {isDefault ? "★ default" : "Set default"}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleStyle(s)}
                          className={cn(
                            "text-[10px] px-2 py-1 rounded-md transition-colors",
                            enabled
                              ? "bg-white/5 hover:bg-white/10 text-surface-300"
                              : "bg-success-500/20 hover:bg-success-500/30 text-success-100",
                          )}
                        >
                          {enabled ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-surface-500">
                Fun Mode artistic transforms (cartoon / vintage / neon / superhero,
                etc.) can be tuned later from the settings panel.
              </p>
            </div>
          )}

          {step.id === "voice" && (
            <div className="space-y-2">
              <p className="text-sm text-surface-200">
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
                className="bg-white/5 border-white/10 focus:border-primary-400"
              />
              <p className="text-[11px] text-surface-500">
                Examples that work: tone words ("warm, no hype"), forbidden clichés
                ("don't say 'amazing deal'"), local color ("we're a Detroit shop —
                Tigers, Lions, never Buckeyes").
              </p>
            </div>
          )}

          {step.id === "banned" && (
            <div className="space-y-2">
              <p className="text-sm text-surface-200">
                Phrases the AI must never use. One per line or comma-separated.
              </p>
              <Textarea
                label="Banned phrases"
                value={banned}
                onChange={(e) => setBanned(e.target.value)}
                placeholder={`guaranteed approval\nno credit check\nlowest price guaranteed\nbest deal in town`}
                rows={4}
                fullWidth
                className="bg-white/5 border-white/10 focus:border-primary-400 font-mono text-sm"
              />
              <p className="text-[11px] text-surface-500">
                FTC + most OEM brand standards prohibit "guaranteed approval", "no
                credit check", "lowest price guaranteed". Pre-filled suggestions above —
                keep them or replace.
              </p>
            </div>
          )}

          {step.id === "color" && (
            <div className="space-y-2">
              <p className="text-sm text-surface-200">
                Your dealership's primary brand color. Used to tint buttons + accents
                across the app.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={HEX_RE.test(color) ? color : "#1d4ed8"}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-12 w-16 rounded-lg border border-white/10 bg-transparent cursor-pointer"
                  aria-label="Pick brand color"
                />
                <Input
                  label="Hex value"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#1d4ed8"
                  fullWidth
                  className="bg-white/5 border-white/10 focus:border-primary-400 font-mono"
                />
              </div>
              {color && HEX_RE.test(color) && (
                <div className="flex items-center gap-2 mt-2 text-[11px] text-surface-400">
                  <div className="h-4 w-4 rounded-full" style={{ background: color }} />
                  Preview
                </div>
              )}
            </div>
          )}

          {step.id === "approval" && (
            <div className="space-y-3">
              <p className="text-sm text-surface-200">
                Should every salesperson post require manager approval before it's
                counted as published? You can change this anytime.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRequiresApproval(false)}
                  className={cn(
                    "p-3 rounded-xl border text-left text-sm transition-colors",
                    !requiresApproval
                      ? "border-success-500/50 bg-success-500/10 text-success-100"
                      : "border-white/10 bg-white/5 text-surface-300 hover:border-white/20",
                  )}
                >
                  <div className="font-semibold">No review needed</div>
                  <div className="text-[11px] mt-1 opacity-80">
                    Faster — salespeople post immediately. Best when the team is
                    experienced.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setRequiresApproval(true)}
                  className={cn(
                    "p-3 rounded-xl border text-left text-sm transition-colors",
                    requiresApproval
                      ? "border-warning-500/50 bg-warning-500/10 text-warning-100"
                      : "border-white/10 bg-white/5 text-surface-300 hover:border-white/20",
                  )}
                >
                  <div className="font-semibold">Manager approves first</div>
                  <div className="text-[11px] mt-1 opacity-80">
                    Safer — GSM reviews every post before it's marked published.
                    Recommended for new teams.
                  </div>
                </button>
              </div>
            </div>
          )}

          {step.id === "done" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="w-14 h-14 rounded-full bg-success-500/20 flex items-center justify-center">
                <Check className="h-7 w-7 text-success-400" />
              </div>
              <div className="text-lg font-semibold text-surface-50">
                {dealer.name} is set up
              </div>
              <div className="text-xs text-surface-400">
                You can change any of this anytime from the dealer card.
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {error && (
        <div className="rounded-xl border border-error-700/50 bg-error-900/40 px-3 py-2 text-error-100 text-xs">
          {error}
        </div>
      )}

      {step.id !== "done" && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ChevronLeft className="h-3.5 w-3.5" />}
            onClick={prev}
            disabled={stepIdx === 0 || saving}
          >
            Back
          </Button>
          {stepIdx < STEPS.findIndex((s) => s.id === "approval") ? (
            <Button
              variant="filled"
              size="sm"
              rightIcon={<ChevronRight className="h-3.5 w-3.5" />}
              onClick={next}
              disabled={saving}
              style={{
                background:
                  "linear-gradient(135deg, var(--brand-primary-500), var(--brand-primary))",
              }}
            >
              Next
            </Button>
          ) : (
            <Button
              variant="filled"
              size="sm"
              leftIcon={
                saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )
              }
              onClick={handleFinish}
              disabled={saving}
              style={{
                background:
                  "linear-gradient(135deg, var(--brand-primary-500), var(--brand-primary))",
              }}
            >
              {saving ? "Saving…" : "Finish setup"}
            </Button>
          )}
        </div>
      )}
    </motion.div>
  );
};
