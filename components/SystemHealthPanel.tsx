import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Database,
  KeyRound,
  ShieldCheck,
  Server,
} from "lucide-react";
import { Button } from "./ui/Button";
import { cn } from "../utils/classNames";

interface HealthPayload {
  ok: boolean;
  ts: string;
  checks: {
    pocketbase: boolean;
    gemini_key_set: boolean;
    proxy_token_set: boolean;
    anthropic_key_set: boolean;
    openai_key_set: boolean;
    claude_fallback_enabled: boolean;
    openai_fallback_enabled: boolean;
    admin_dealer_code_set: boolean;
    turnstile_enforcement_enabled: boolean;
    turnstile_secret_set: boolean;
    turnstile_site_key_set: boolean;
    trusted_proxy_configured: boolean;
    legacy_client_compatibility_enabled: boolean;
    off_box_backup_configured: boolean;
    off_box_restore_ready: boolean;
  };
  counts?: {
    dealers: number;
    posts_24h: number;
    photo_releases_24h: number;
  };
  version: string;
  releaseSha: string;
  apiContractVersion: string;
  modelPolicyVersion: string;
  backup: {
    configured: boolean;
    lastVerifiedAt: string | null;
    verifiedReleaseSha: string | null;
    maxAgeHours: number;
    status:
      | "not_configured"
      | "verification_required"
      | "release_unknown"
      | "release_mismatch"
      | "stale"
      | "verified";
  };
  generation?: {
    aiSuccesses24h: number;
    basicFallbacks24h: number;
    fallbackAttempts24h: number;
    standardTier24h: number;
    studioTier24h: number;
    lastSuccessfulAt: string | null;
    providerAttempts24h: number;
    providerFailures24h: number;
    lastProviderAttemptAt: string | null;
  };
  recentErrors?: {
    total24h: number;
    topActions: Array<{ name: string; count: number }>;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const healthCheckKeys: Array<keyof HealthPayload["checks"]> = [
  "pocketbase",
  "gemini_key_set",
  "proxy_token_set",
  "anthropic_key_set",
  "openai_key_set",
  "claude_fallback_enabled",
  "openai_fallback_enabled",
  "admin_dealer_code_set",
  "turnstile_enforcement_enabled",
  "turnstile_secret_set",
  "turnstile_site_key_set",
  "trusted_proxy_configured",
  "legacy_client_compatibility_enabled",
  "off_box_backup_configured",
  "off_box_restore_ready",
];

const backupStatuses: HealthPayload["backup"]["status"][] = [
  "not_configured",
  "verification_required",
  "release_unknown",
  "release_mismatch",
  "stale",
  "verified",
];

const isHealthPayload = (value: unknown): value is HealthPayload => {
  if (!isRecord(value) || !isRecord(value.checks) || !isRecord(value.backup)) {
    return false;
  }
  const checks = value.checks;
  const backup = value.backup;

  return (
    typeof value.ok === "boolean" &&
    typeof value.ts === "string" &&
    typeof value.version === "string" &&
    typeof value.releaseSha === "string" &&
    typeof value.apiContractVersion === "string" &&
    typeof value.modelPolicyVersion === "string" &&
    healthCheckKeys.every((key) => typeof checks[key] === "boolean") &&
    typeof backup.configured === "boolean" &&
    (backup.lastVerifiedAt === null || typeof backup.lastVerifiedAt === "string") &&
    (backup.verifiedReleaseSha === null ||
      typeof backup.verifiedReleaseSha === "string") &&
    backupStatuses.includes(backup.status as HealthPayload["backup"]["status"]) &&
    typeof backup.maxAgeHours === "number"
  );
};

const checkRows: Array<{
  key: keyof HealthPayload["checks"];
  label: string;
  icon: typeof Activity;
  critical: boolean;
  hint: string;
}> = [
  {
    key: "pocketbase",
    label: "PocketBase",
    icon: Database,
    critical: true,
    hint: "Database backend. If down, nothing works.",
  },
  {
    key: "gemini_key_set",
    label: "Gemini API key",
    icon: KeyRound,
    critical: true,
    hint: "GEMINI_API_KEY env var. Required for text, image, and Veo video generation.",
  },
  {
    key: "anthropic_key_set",
    label: "Anthropic API key",
    icon: KeyRound,
    critical: false,
    hint: "Optional server credential. The matching server and frontend fallback flags must also be enabled.",
  },
  {
    key: "openai_key_set",
    label: "OpenAI API key",
    icon: KeyRound,
    critical: false,
    hint: "Optional server credential. The matching server and frontend fallback flags must also be enabled.",
  },
  {
    key: "claude_fallback_enabled",
    label: "Claude fallback enabled",
    icon: ShieldCheck,
    critical: false,
    hint: "Requires ANTHROPIC_API_KEY, ENABLE_CLAUDE_FALLBACK=true, and the matching Vite build flag.",
  },
  {
    key: "openai_fallback_enabled",
    label: "GPT Image fallback enabled",
    icon: ShieldCheck,
    critical: false,
    hint: "Requires OPENAI_API_KEY, ENABLE_OPENAI_FALLBACK=true, and the matching Vite build flag.",
  },
  {
    key: "admin_dealer_code_set",
    label: "ADMIN_DEALER_CODE",
    icon: ShieldCheck,
    critical: true,
    hint: "Required for exact-case super-admin login; final releases use 12 mixed-case alphanumeric characters.",
  },
  {
    key: "trusted_proxy_configured",
    label: "Vercel to Fly trust",
    icon: ShieldCheck,
    critical: true,
    hint: "Authenticates Vercel's original-client-IP header before login rate limiting uses it.",
  },
  {
    key: "turnstile_enforcement_enabled",
    label: "Turnstile enforcement",
    icon: ShieldCheck,
    critical: false,
    hint: "Enabled only after the staged challenge-capable frontend is promoted.",
  },
  {
    key: "turnstile_secret_set",
    label: "Turnstile verifier",
    icon: KeyRound,
    critical: false,
    hint: "Server-only production siteverify credential; Cloudflare test keys are rejected on Fly.",
  },
  {
    key: "turnstile_site_key_set",
    label: "Turnstile site key",
    icon: ShieldCheck,
    critical: false,
    hint: "Public widget key compiled into the exact frontend artifact and recorded at runtime.",
  },
  {
    key: "legacy_client_compatibility_enabled",
    label: "Legacy client bridge",
    icon: AlertTriangle,
    critical: false,
    hint: "Temporary masked-roster/PIN-edit bridge; disable immediately after frontend promotion.",
  },
  {
    key: "off_box_restore_ready",
    label: "Release restore evidence",
    icon: Database,
    critical: true,
    hint: "A recent R2 restore drill must match the exact running release.",
  },
];

/**
 * Super-admin system health card. Pings /api/app/health and visualizes each
 * required env var + the PB connection + 24h activity counts. Use this as the
 * first stop when debugging a production issue.
 */
export const SystemHealthPanel: React.FC = () => {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch("/api/app/health", { credentials: "include" });
    } catch (err) {
      // A transport failure means the old snapshot can no longer describe the
      // service we are connected to. Clear it instead of showing stale green.
      setData(null);
      setLastChecked(null);
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      return;
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // HTML proxy errors and truncated responses are not health snapshots.
      setData(null);
      setLastChecked(null);
      setError(`Health response was not valid JSON (${res.status}).`);
      setLoading(false);
      return;
    }

    try {
      if (!isHealthPayload(body)) {
        // A JSON error envelope is useful evidence that the endpoint replied,
        // but it must not replace (or erase) the last rich diagnostics payload.
        const detail =
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "Health response did not include diagnostics.";
        setError(`${detail} (${res.status})`);
        return;
      }

      // Readiness failures deliberately use HTTP 503. The structured payload
      // is the diagnostic UI, so render it regardless of HTTP success status.
      setData(body);
      setLastChecked(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Auto-refresh every 60s while panel is mounted
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const overallOk = data?.ok ?? false;
  const criticalFailures = checkRows.filter(
    (r) => r.critical && data && !data.checks[r.key],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface-900/60 border border-surface-800 rounded-2xl p-4 sm:p-6 space-y-4 shadow-elevation-2 backdrop-blur-xl"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
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
              <Server className="w-5 h-5 text-primary-300" />
              System health
              {data &&
                (overallOk ? (
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-success-300 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> all green
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-error-300 inline-flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> degraded
                  </span>
                ))}
            </h3>
            <p className="text-xs text-surface-400">
              {lastChecked
                ? `Last checked ${lastChecked.toLocaleTimeString()} — auto-refreshes every minute`
                : "Loading…"}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={
            loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )
          }
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-error-700/50 bg-error-900/40 px-3 py-2 text-error-100 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-error-400" /> {error}
        </div>
      )}

      {criticalFailures.length > 0 && (
        <div className="rounded-xl border border-error-700/50 bg-error-900/30 px-3 py-2 text-error-100 text-xs">
          <strong>Critical:</strong> {criticalFailures.map((c) => c.label).join(", ")} —
          fix before users hit the app.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {checkRows.map((row) => {
          const ok = data ? data.checks[row.key] : null;
          const Icon = row.icon;
          return (
            <div
              key={row.key}
              className={cn(
                "rounded-xl border p-3 flex items-start gap-3",
                ok === true && "border-success-500/30 bg-success-500/5",
                ok === false && row.critical && "border-error-500/40 bg-error-500/5",
                ok === false &&
                  !row.critical &&
                  "border-warning-500/30 bg-warning-500/5",
                ok === null && "border-surface-800 bg-surface-900/40",
              )}
            >
              <Icon
                className={cn(
                  "w-4 h-4 flex-shrink-0 mt-0.5",
                  ok === true && "text-success-300",
                  ok === false && row.critical && "text-error-300",
                  ok === false && !row.critical && "text-warning-300",
                  ok === null && "text-surface-400",
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-surface-50">{row.label}</div>
                <div className="text-[11px] text-surface-400 leading-relaxed">
                  {row.hint}
                </div>
              </div>
              {ok === true && (
                <CheckCircle2 className="w-4 h-4 text-success-300 flex-shrink-0" />
              )}
              {ok === false && (
                <XCircle
                  className={cn(
                    "w-4 h-4 flex-shrink-0",
                    row.critical ? "text-error-300" : "text-warning-300",
                  )}
                />
              )}
              {ok === null && (
                <Loader2 className="w-4 h-4 text-surface-400 flex-shrink-0 animate-spin" />
              )}
            </div>
          );
        })}
      </div>

      {data?.counts ? (
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-surface-800">
          <Stat label="Dealers" value={data.counts.dealers} />
          <Stat label="Posts (24h)" value={data.counts.posts_24h} />
          <Stat label="Releases (24h)" value={data.counts.photo_releases_24h} />
        </div>
      ) : data ? (
        <div className="rounded-xl border border-surface-800 bg-surface-900/40 px-3 py-2 text-xs text-surface-400">
          Activity counts are unavailable from this health endpoint.
        </div>
      ) : null}

      {data ? (
        <div className="grid gap-3 border-t border-surface-800 pt-3 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-xl border border-surface-800 bg-surface-950/45 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-500">
                  Release contract
                </p>
                <p className="mt-1 font-mono text-xs text-surface-200">
                  {data.releaseSha === "unknown"
                    ? "Release SHA unavailable"
                    : data.releaseSha.slice(0, 16)}
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-surface-300">
                API {data.apiContractVersion}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-surface-400">
              <span>Health v{data.version}</span>
              <span aria-hidden="true">·</span>
              <span>Model policy v{data.modelPolicyVersion}</span>
            </div>
          </section>

          <section
            className={cn(
              "rounded-xl border p-4",
              data.backup.status === "verified"
                ? "border-success-500/25 bg-success-500/5"
                : "border-warning-500/25 bg-warning-500/5",
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-500">
              Recovery readiness
            </p>
            <p className="mt-1 text-sm font-semibold text-surface-100">
              {data.backup.status === "verified"
                ? "Off-box restore verified"
                : data.backup.status === "verification_required"
                  ? "Restore drill required"
                  : data.backup.status === "release_unknown"
                    ? "Running release is unidentified"
                    : data.backup.status === "release_mismatch"
                      ? "Restore evidence is for another release"
                      : data.backup.status === "stale"
                        ? "Restore evidence has expired"
                        : "R2 backup not configured"}
            </p>
            <p className="mt-1 text-xs text-surface-400">
              {data.backup.lastVerifiedAt
                ? `Last verified ${new Date(data.backup.lastVerifiedAt).toLocaleString()}`
                : "No verified restore timestamp is available for this release."}
            </p>
            <p className="mt-1 text-[11px] text-surface-500">
              Evidence expires after {data.backup.maxAgeHours} hours and must match this
              release SHA.
            </p>
          </section>
        </div>
      ) : null}

      {data?.generation ? (
        <section className="space-y-3 rounded-xl border border-surface-800 bg-surface-950/35 p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-500">
                Generation · last 24 hours
              </p>
              <p className="mt-1 text-sm text-surface-300">
                Provider results and clearly labeled safe-template fallbacks.
              </p>
            </div>
            <p className="text-xs text-surface-500">
              {data.generation.lastSuccessfulAt
                ? `Last success ${new Date(data.generation.lastSuccessfulAt).toLocaleString()}`
                : "No recent provider success"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <MiniStat label="AI success" value={data.generation.aiSuccesses24h} />
            <MiniStat
              label="Basic fallback"
              value={data.generation.basicFallbacks24h}
              warning={data.generation.basicFallbacks24h > 0}
            />
            <MiniStat
              label="Fallback hops"
              value={data.generation.fallbackAttempts24h}
            />
            <MiniStat label="Standard" value={data.generation.standardTier24h} />
            <MiniStat label="Studio" value={data.generation.studioTier24h} />
            <MiniStat
              label="Provider attempts"
              value={data.generation.providerAttempts24h}
            />
            <MiniStat
              label="Provider failures"
              value={data.generation.providerFailures24h}
              warning={data.generation.providerFailures24h > 0}
            />
          </div>
        </section>
      ) : null}

      {data?.recentErrors ? (
        <section className="rounded-xl border border-surface-800 bg-surface-950/35 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-500">
                Actionable client errors · 24 hours
              </p>
              <p className="mt-1 text-sm text-surface-300">
                Redacted aggregates only; retained for 14 days.
              </p>
            </div>
            <span className="text-2xl font-bold tabular-nums text-surface-50">
              {data.recentErrors.total24h}
            </span>
          </div>
          {data.recentErrors.topActions.length > 0 ? (
            <ul className="mt-3 divide-y divide-white/5 text-xs">
              {data.recentErrors.topActions.map((action) => (
                <li
                  key={action.name}
                  className="flex items-center justify-between gap-3 py-2 text-surface-300"
                >
                  <code className="min-w-0 truncate">{action.name}</code>
                  <span className="font-semibold tabular-nums text-surface-100">
                    {action.count}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-success-300">
              No redacted client errors recorded in this window.
            </p>
          )}
        </section>
      ) : null}
    </motion.div>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-xl border border-surface-800 bg-surface-900/40 px-3 py-2 text-center">
    <div className="text-2xl font-bold text-surface-50 tabular-nums">{value}</div>
    <div className="text-[10px] uppercase tracking-wide text-surface-400">{label}</div>
  </div>
);

const MiniStat: React.FC<{
  label: string;
  value: number;
  warning?: boolean;
}> = ({ label, value, warning = false }) => (
  <div
    className={cn(
      "rounded-lg border px-3 py-2",
      warning
        ? "border-warning-500/20 bg-warning-500/5"
        : "border-white/5 bg-white/[0.025]",
    )}
  >
    <div className="text-lg font-bold tabular-nums text-surface-50">{value}</div>
    <div className="text-[9px] font-semibold uppercase tracking-wide text-surface-500">
      {label}
    </div>
  </div>
);
