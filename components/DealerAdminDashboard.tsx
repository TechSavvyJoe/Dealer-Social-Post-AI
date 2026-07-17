import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Settings,
  Users,
  Palette,
  Ban,
  Wand2,
  Trophy,
  LogOut,
  Loader2,
  Save,
  ShieldCheck,
  Pencil,
} from "lucide-react";
import { PersonEditModal } from "./PersonEditModal";
import type { Person } from "../services/salespeople";
import { Button } from "./ui/Button";
import { Input, Textarea } from "./ui/Input";
import { Leaderboard } from "./Leaderboard";
import { ApprovalQueue } from "./ApprovalQueue";
import { PostHistory } from "./PostHistory";
import { DealerSetupWizard } from "./DealerSetupWizard";
import { useAppStore } from "../stores/appStore";
import * as db from "../services/database";
import { cn } from "../utils/classNames";
import { triggerHapticFeedback } from "../utils/haptics";
import { StyleOption } from "../types";
import { CustomScenarioManager } from "./CustomScenarioManager";
import { HoursPicker } from "./HoursPicker";
import {
  defaultWeekHours,
  parseHoursString,
  serializeHours,
  type WeekHours,
} from "../utils/hoursFormat";

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Per-dealership admin dashboard. The GSM/GM lands here when they log in
 * with their dealership's `admin_code` (not the shared salesperson code).
 *
 * Scoped to their own dealership only — all the data on this screen
 * (leaderboard, approvals, history) is already filtered to the session
 * dealer by the /api/app/posts endpoint, so nothing leaks across tenants.
 *
 * Distinct from the super-admin AdminDashboard which manages MANY dealers
 * across the platform.
 */
type Tab = "overview" | "settings" | "team";

export const DealerAdminDashboard: React.FC = () => {
  const dealer = useAppStore((s) => s.currentDealer);
  const [tab, setTab] = useState<Tab>("overview");

  // First-time setup wizard surfaces if brand voice + color aren't set yet.
  const [wizardDismissed, setWizardDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("dsp.dealerSetupDismissed") === "1";
    } catch {
      return false;
    }
  });
  const showWizard =
    !wizardDismissed && dealer && (!dealer.brand_voice || !dealer.brand_color);

  if (!dealer) {
    return (
      <div className="p-8 text-center text-surface-300">
        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  const handleWizardSave = async (fields: Record<string, string | boolean>) => {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) =>
      fd.append(k, typeof v === "boolean" ? (v ? "true" : "false") : v)
    );
    const updated = await db.updateDealerWithFile(dealer.id, fd);
    useAppStore.setState((s) => ({
      currentDealer: s.currentDealer
        ? { ...s.currentDealer, ...fields, ...updated }
        : s.currentDealer,
    }));
    return updated;
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-2 sm:p-4 space-y-6">
      {/* Header with dealership identity + role chip */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between gap-3 flex-wrap"
      >
        <div className="flex items-center gap-3">
          {dealer.logo ? (
            <img
              src={dealer.logo}
              alt={`${dealer.name} logo`}
              className="w-12 h-12 rounded-xl object-contain bg-white/10 p-1 ring-1 ring-white/10"
            />
          ) : (
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white text-xl shadow-lg"
              style={{
                background:
                  "linear-gradient(135deg, var(--brand-primary-500), var(--brand-primary))",
              }}
            >
              {dealer.name.charAt(0)}
            </div>
          )}
          <div>
            <div className="text-xl font-bold text-surface-50">{dealer.name}</div>
            <div className="flex items-center gap-2 text-[11px] text-surface-400">
              <ShieldCheck className="w-3 h-3 text-success-300" />
              Manager dashboard
            </div>
          </div>
        </div>
      </motion.div>

      {showWizard && (
        <DealerSetupWizard
          dealer={dealer}
          onSave={handleWizardSave}
          onDismiss={() => {
            setWizardDismissed(true);
            try {
              localStorage.setItem("dsp.dealerSetupDismissed", "1");
            } catch {
              /* ignore */
            }
          }}
        />
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-surface-950/60 rounded-xl border border-surface-800 w-full sm:w-auto sm:inline-flex">
        {(
          [
            { key: "overview", label: "Overview", icon: Trophy },
            { key: "settings", label: "Settings", icon: Settings },
            { key: "team", label: "Team", icon: Users },
          ] as Array<{ key: Tab; label: string; icon: typeof Trophy }>
        ).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => {
                triggerHapticFeedback();
                setTab(t.key);
              }}
              className={cn(
                "flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
                tab === t.key
                  ? "bg-primary-500/30 text-primary-100"
                  : "text-surface-400 hover:text-surface-200"
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" && (
        <>
          <Leaderboard />
          <ApprovalQueue />
          <PostHistory />
        </>
      )}

      {tab === "settings" && (
        <DealerSettingsCard dealer={dealer} onSaved={handleWizardSave} />
      )}

      {tab === "team" && <DealerTeamCard />}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Settings card — inline editing of voice / color / banned / approval gate
// ----------------------------------------------------------------------------
interface DealerSettingsProps {
  dealer: NonNullable<ReturnType<typeof useAppStore.getState>["currentDealer"]>;
  onSaved: (fields: Record<string, string | boolean>) => Promise<unknown>;
}

const DealerSettingsCard: React.FC<DealerSettingsProps> = ({ dealer, onSaved }) => {
  // Voice / brand
  const [voice, setVoice] = useState(dealer.brand_voice || "");
  const [banned, setBanned] = useState(dealer.banned_phrases || "");
  const [color, setColor] = useState(dealer.brand_color || "");
  const [oem, setOem] = useState(dealer.oem_affiliation || "");
  const [approval, setApproval] = useState(!!dealer.requires_approval);

  // Contact + identity
  const [website, setWebsite] = useState(dealer.website || "");
  const [phone, setPhone] = useState(dealer.phone || "");
  const [address, setAddress] = useState(dealer.address || "");
  const [hoursWeek, setHoursWeek] = useState<WeekHours>(
    () => parseHoursString(dealer.hours) || defaultWeekHours(),
  );
  const hoursSerialized = serializeHours(hoursWeek);
  const [tagline, setTagline] = useState(dealer.tagline || "");

  // Social
  const [facebookUrl, setFacebookUrl] = useState(dealer.facebook_url || "");
  const [instagramHandle, setInstagramHandle] = useState(
    dealer.instagram_handle || ""
  );
  const [tiktokHandle, setTiktokHandle] = useState(dealer.tiktok_handle || "");
  const [xHandle, setXHandle] = useState(dealer.x_handle || "");
  const [gbpUrl, setGbpUrl] = useState(dealer.gbp_url || "");

  // Generation defaults
  const [defaultHashtags, setDefaultHashtags] = useState(
    dealer.default_hashtags || ""
  );
  const [defaultFooter, setDefaultFooter] = useState(dealer.default_footer || "");

  // Overlay preferences
  const [enabledStyles, setEnabledStyles] = useState<Set<string>>(() => {
    const raw = (dealer.enabled_styles || "").trim();
    return raw
      ? new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))
      : new Set(Object.values(StyleOption));
  });
  const [defaultStyle, setDefaultStyle] = useState(dealer.default_style || "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const enabledStylesStr = Array.from(enabledStyles).join(",");

  const dirty =
    voice !== (dealer.brand_voice || "") ||
    banned !== (dealer.banned_phrases || "") ||
    color !== (dealer.brand_color || "") ||
    oem !== (dealer.oem_affiliation || "") ||
    approval !== !!dealer.requires_approval ||
    website !== (dealer.website || "") ||
    phone !== (dealer.phone || "") ||
    address !== (dealer.address || "") ||
    hoursSerialized !== (dealer.hours || "") ||
    tagline !== (dealer.tagline || "") ||
    facebookUrl !== (dealer.facebook_url || "") ||
    instagramHandle !== (dealer.instagram_handle || "") ||
    tiktokHandle !== (dealer.tiktok_handle || "") ||
    xHandle !== (dealer.x_handle || "") ||
    gbpUrl !== (dealer.gbp_url || "") ||
    defaultHashtags !== (dealer.default_hashtags || "") ||
    defaultFooter !== (dealer.default_footer || "") ||
    enabledStylesStr !== (dealer.enabled_styles || "") ||
    defaultStyle !== (dealer.default_style || "");

  const toggleStyle = (id: string) => {
    setEnabledStyles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (defaultStyle === id) setDefaultStyle("");
      } else {
        next.add(id);
      }
      if (next.size === 0) next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setError(null);
    if (color && !HEX_RE.test(color.trim())) {
      setError("Brand color should be a hex value like #1d4ed8.");
      return;
    }
    setSaving(true);
    try {
      const fields: Record<string, string | boolean> = {
        brand_voice: voice.trim(),
        banned_phrases: banned.trim(),
        brand_color: color.trim(),
        oem_affiliation: oem.trim(),
        requires_approval: approval,
        website: website.trim(),
        phone: phone.trim(),
        address: address.trim(),
        hours: hoursSerialized,
        tagline: tagline.trim(),
        facebook_url: facebookUrl.trim(),
        instagram_handle: instagramHandle.trim().replace(/^@/, ""),
        tiktok_handle: tiktokHandle.trim().replace(/^@/, ""),
        x_handle: xHandle.trim().replace(/^@/, ""),
        gbp_url: gbpUrl.trim(),
        default_hashtags: defaultHashtags.trim(),
        default_footer: defaultFooter.trim(),
        enabled_styles: enabledStylesStr,
        default_style: defaultStyle,
      };
      await onSaved(fields);
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface-900/60 border border-surface-800 rounded-2xl p-4 sm:p-6 space-y-6 shadow-elevation-2 backdrop-blur-xl"
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
        <div>
          <h3 className="text-xl font-bold text-surface-50 flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary-300" />
            Dealership settings
          </h3>
          <p className="text-xs text-surface-400">
            Everything here applies to every post your team generates.
          </p>
        </div>
      </div>

      {/* ---- Contact + identity ---- */}
      <section className="space-y-2">
        <div className="text-sm font-semibold text-surface-50">
          Contact & identity
        </div>
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
        <HoursPicker
          value={hoursWeek}
          onChange={setHoursWeek}
          preview={hoursSerialized}
        />
        <Input
          label="Tagline"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="Family-owned since 1985 · No-haggle pricing"
          fullWidth
          className="bg-white/5 border-white/10 focus:border-primary-400"
        />
      </section>

      {/* ---- Social handles ---- */}
      <section className="space-y-2">
        <div className="text-sm font-semibold text-surface-50">
          Social presence
        </div>
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
      </section>

      {/* ---- Voice ---- */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-surface-50">
          <Wand2 className="w-4 h-4 text-primary-300" />
          Brand voice
        </div>
        <Textarea
          label=""
          aria-label="Brand voice"
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          rows={4}
          fullWidth
          placeholder={`e.g. "Confident, no exclamation points, never 'family-owned'. Local Detroit references are good."`}
          className="bg-white/5 border-white/10 focus:border-primary-400"
        />
      </section>

      {/* ---- Default hashtags + footer ---- */}
      <section className="space-y-2">
        <div className="text-sm font-semibold text-surface-50">
          Defaults applied to every post
        </div>
        <Textarea
          label="Default hashtags (one per line)"
          value={defaultHashtags}
          onChange={(e) => setDefaultHashtags(e.target.value)}
          rows={3}
          fullWidth
          placeholder={"#YourDealership\n#DetroitFord\n#NewRide"}
          className="bg-white/5 border-white/10 focus:border-primary-400 font-mono text-sm"
        />
        <Textarea
          label="Default footer / CTA"
          value={defaultFooter}
          onChange={(e) => setDefaultFooter(e.target.value)}
          rows={2}
          fullWidth
          placeholder="Stop by 123 Main St — open until 9pm. Call us at (313) 555-0100."
          className="bg-white/5 border-white/10 focus:border-primary-400"
        />
      </section>

      {/* ---- Image overlay management ---- */}
      <section className="space-y-2">
        <div className="text-sm font-semibold text-surface-50">
          Image overlay styles
        </div>
        <p className="text-[11px] text-surface-400">
          Pick which design styles your team can use. Star one to preselect it
          when a salesperson opens the customizer.
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
                    : "border-white/10 bg-white/5 opacity-60"
                )}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-surface-50">
                    {s}
                  </div>
                  <div className="text-[10px] text-surface-400">
                    {enabled ? "available to salespeople" : "hidden"}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    disabled={!enabled}
                    onClick={() => setDefaultStyle(isDefault ? "" : s)}
                    className={cn(
                      "text-[10px] px-2 py-1 rounded-md transition-colors",
                      isDefault
                        ? "bg-amber-500/30 text-amber-100"
                        : "bg-white/5 hover:bg-white/10 text-surface-300",
                      !enabled && "opacity-30 cursor-not-allowed"
                    )}
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
                        : "bg-success-500/20 hover:bg-success-500/30 text-success-100"
                    )}
                  >
                    {enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <CustomScenarioManager
        customScenariosJson={dealer.custom_scenarios}
        onSave={async (json) => {
          await onSaved({ custom_scenarios: json });
        }}
      />

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-surface-50">
          <Ban className="w-4 h-4 text-error-300" />
          Banned phrases
        </div>
        <Textarea
          label=""
          aria-label="Banned phrases (one per line)"
          value={banned}
          onChange={(e) => setBanned(e.target.value)}
          rows={4}
          fullWidth
          placeholder={`guaranteed approval\nno credit check\nlowest price guaranteed`}
          className="bg-white/5 border-white/10 focus:border-primary-400 font-mono text-sm"
        />
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-surface-50">
            <Palette className="w-4 h-4 text-primary-300" />
            Brand color
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={HEX_RE.test(color) ? color : "#1d4ed8"}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-14 rounded-lg border border-white/10 bg-transparent cursor-pointer"
              aria-label="Pick brand color"
            />
            <Input
              label=""
              aria-label="Brand color hex value"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#1d4ed8"
              fullWidth
              className="bg-white/5 border-white/10 focus:border-primary-400 font-mono"
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-semibold text-surface-50">
            OEM affiliation
          </div>
          <Input
            label=""
            aria-label="OEM affiliation"
            value={oem}
            onChange={(e) => setOem(e.target.value)}
            placeholder="Ford, GM, Stellantis, Independent…"
            fullWidth
            className="bg-white/5 border-white/10 focus:border-primary-400"
          />
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-sm font-semibold text-surface-50">
          Manager approval
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setApproval(false)}
            className={cn(
              "px-3 py-2 rounded-lg text-sm transition-colors border",
              !approval
                ? "border-success-500/40 bg-success-500/10 text-success-100"
                : "border-white/10 bg-white/5 text-surface-300"
            )}
          >
            Auto-publish
          </button>
          <button
            type="button"
            onClick={() => setApproval(true)}
            className={cn(
              "px-3 py-2 rounded-lg text-sm transition-colors border",
              approval
                ? "border-warning-500/40 bg-warning-500/10 text-warning-100"
                : "border-white/10 bg-white/5 text-surface-300"
            )}
          >
            Require manager approval
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-error-700/50 bg-error-900/40 px-3 py-2 text-error-100 text-xs">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-white/10">
        <div className="text-[11px] text-surface-500">
          {savedAt
            ? `Saved ${savedAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : dirty
            ? "Unsaved changes"
            : "Up to date"}
        </div>
        <Button
          variant="filled"
          size="sm"
          disabled={!dirty || saving}
          leftIcon={
            saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )
          }
          onClick={handleSave}
          style={{
            background:
              "linear-gradient(135deg, var(--brand-primary-500), var(--brand-primary))",
          }}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </motion.div>
  );
};

// ----------------------------------------------------------------------------
// Team card — proper salespeople CRUD against the new salespeople collection.
// Listed members are deduped against the post log so the GSM can see who has
// generated posts even if they haven't been added to the formal roster yet.
// ----------------------------------------------------------------------------
const DealerTeamCard: React.FC = () => {
  const [roster, setRoster] = useState<
    Array<{
      id?: string;
      name: string;
      pin?: string;
      active: boolean;
      count: number;
      lastAt?: string;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newPin, setNewPin] = useState("");
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [oneTimeCode, setOneTimeCode] = useState<{
    name: string;
    pin: string;
  } | null>(null);
  const dealer = useAppStore((s) => s.currentDealer);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sp, postsRes] = await Promise.all([
        import("../services/salespeople").then((m) => m.listSalespeople(true)),
        fetch("/api/app/posts?limit=1000", { credentials: "include" }).then(
          (r) => (r.ok ? r.json() : { items: [] })
        ),
      ]);
      const counts = new Map<string, { count: number; lastAt: string }>();
      const looseNames = new Map<string, { count: number; lastAt: string }>();
      for (const p of (postsRes.items as any[]) || []) {
        const stamp = p.generated_at as string;
        if (p.salesperson_id) {
          const cur = counts.get(p.salesperson_id) || { count: 0, lastAt: stamp };
          cur.count += 1;
          if (stamp > cur.lastAt) cur.lastAt = stamp;
          counts.set(p.salesperson_id, cur);
        } else if (p.salesperson_name) {
          const key = (p.salesperson_name as string).trim();
          if (!key) continue;
          const cur = looseNames.get(key) || { count: 0, lastAt: stamp };
          cur.count += 1;
          if (stamp > cur.lastAt) cur.lastAt = stamp;
          looseNames.set(key, cur);
        }
      }

      const rosterRows = sp.map((p) => ({
        id: p.id,
        name: p.name,
        pin: p.pin,
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

      const combined = [...rosterRows, ...looseRows].sort(
        (a, b) => b.count - a.count
      );
      setRoster(combined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async () => {
    setError(null);
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const m = await import("../services/salespeople");
      if (newPin.trim() && !/^\d{4}$/.test(newPin.trim())) {
        setError("Access code must be exactly 4 digits (or leave blank).");
        setSaving(false);
        return;
      }
      const created = await m.addSalesperson({
        name: newName.trim(),
        pin: newPin.trim() || undefined,
        role: "salesperson",
      });
      setNewName("");
      setNewPin("");
      if (created.pin) {
        setError(null);
        setOneTimeCode({ name: created.name, pin: created.pin });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePromoteLoose = async (name: string) => {
    setSaving(true);
    try {
      const m = await import("../services/salespeople");
      await m.addSalesperson({ name });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface-900/60 border border-surface-800 rounded-2xl p-4 sm:p-6 space-y-4 shadow-elevation-2 backdrop-blur-xl"
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
        <div>
          <h3 className="text-xl font-bold text-surface-50 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary-300" />
            Your team
          </h3>
          <p className="text-xs text-surface-400">
            Each salesperson gets a personal 4-digit code for sign-in and
            appears in the showroom picker. Deactivate anyone who leaves —
            historical posts stay intact.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
        <div className="flex-1">
          <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
            Add salesperson
          </label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value.slice(0, 120))}
            placeholder="e.g. Sarah Chen"
            className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-surface-100 focus:border-primary-400 focus:outline-none"
          />
        </div>
        <div className="sm:w-32">
          <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
            Code (4 dig.)
          </label>
          <input
            type="text"
            value={newPin}
            onChange={(e) =>
              setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            placeholder="auto"
            inputMode="numeric"
            maxLength={4}
            className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-surface-100 font-mono tracking-widest focus:border-primary-400 focus:outline-none"
          />
        </div>
        <Button
          variant="filled"
          size="md"
          disabled={!newName.trim() || saving}
          leftIcon={
            saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Users className="w-4 h-4" />
            )
          }
          onClick={handleAdd}
          style={{
            background:
              "linear-gradient(135deg, var(--brand-primary-500), var(--brand-primary))",
          }}
        >
          Add
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-error-700/50 bg-error-900/40 px-3 py-2 text-error-100 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 flex items-center justify-center text-surface-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading roster…
        </div>
      ) : roster.length === 0 ? (
        <div className="py-12 text-center text-sm text-surface-400">
          No one on the roster yet — add your first teammate above.
        </div>
      ) : (
        <ul className="space-y-2">
          {roster.map((p) => (
            <li
              key={p.id || `loose:${p.name}`}
              className={cn(
                "flex items-center justify-between rounded-xl border px-3 py-2.5 transition-colors",
                p.active
                  ? "border-white/10 bg-surface-900/40"
                  : "border-white/5 bg-surface-900/20 opacity-60"
              )}
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-surface-50 flex items-center gap-2 flex-wrap">
                  {p.name}
                  {!p.id && (
                    <span className="text-[10px] uppercase tracking-wide text-warning-300 font-semibold">
                      unrostered
                    </span>
                  )}
                  {!p.active && p.id && (
                    <span className="text-[10px] uppercase tracking-wide text-surface-400 font-semibold">
                      inactive
                    </span>
                  )}
                  {p.id && (
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-wide font-semibold rounded-full px-2 py-0.5",
                        p.pin
                          ? "bg-success-500/10 text-success-300"
                          : "bg-surface-800 text-surface-500",
                      )}
                    >
                      {p.pin ? "Code set" : "No code"}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-surface-400">
                  {p.count > 0
                    ? `${p.count} post${p.count === 1 ? "" : "s"}${
                        p.lastAt
                          ? ` · last ${new Date(p.lastAt).toLocaleDateString()}`
                          : ""
                      }`
                    : "No posts yet"}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-lg font-bold text-surface-50 tabular-nums">
                  {p.count}
                </span>
                {p.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingPerson({
                          id: p.id!,
                          dealer: dealer?.id || "",
                          name: p.name,
                          pin: p.pin,
                          active: p.active,
                          role: "salesperson",
                        })
                      }
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-white/5 text-surface-300 hover:bg-white/10"
                      title="Edit profile"
                      aria-label={`Edit ${p.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => p.id && handleToggleActive(p.id, p.active)}
                      className={cn(
                        "min-h-11 text-[11px] px-3 py-2 rounded-md transition-colors",
                        p.active
                          ? "bg-white/5 hover:bg-white/10 text-surface-300"
                          : "bg-success-500/20 hover:bg-success-500/30 text-success-100",
                      )}
                      title={p.active ? "Deactivate" : "Reactivate"}
                    >
                      {p.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => handlePromoteLoose(p.name)}
                    disabled={saving}
                    className="min-h-11 text-[11px] px-3 py-2 rounded-md bg-primary-500/20 hover:bg-primary-500/30 text-primary-100 transition-colors disabled:opacity-50"
                    title="Add this person to the formal roster"
                  >
                    Add to roster
                  </button>
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
        onClose={() => setEditingPerson(null)}
        onSaved={() => {
          setEditingPerson(null);
          void load();
        }}
      />
    </motion.div>
  );
};
