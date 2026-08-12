import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
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
import { assertAuthEpoch, captureAuthEpoch } from "../utils/authBoundary";
import { readApiError } from "../services/apiErrors";

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
    admin_login_configured: boolean;
    turnstile_enforcement_enabled: boolean;
    turnstile_secret_set: boolean;
    turnstile_site_key_set: boolean;
    turnstile_hostnames_configured: boolean;
    trusted_proxy_configured: boolean;
    legacy_client_compatibility_enabled: boolean;
    off_box_backup_configured: boolean;
    off_box_restore_ready: boolean;
    website_integration_configured: boolean;
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
  "admin_login_configured",
  "turnstile_enforcement_enabled",
  "turnstile_secret_set",
  "turnstile_site_key_set",
  "turnstile_hostnames_configured",
  "trusted_proxy_configured",
  "legacy_client_compatibility_enabled",
  "off_box_backup_configured",
  "off_box_restore_ready",
  "website_integration_configured",
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
    key: "admin_login_configured",
    label: "Administrator login",
    icon: ShieldCheck,
    critical: true,
    hint: "Requires the ADMIN_LOGIN_USERNAME and ADMIN_LOGIN_PASSWORD deployment secrets to provision the administrator account.",
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
    key: "turnstile_hostnames_configured",
    label: "Turnstile hostname policy",
    icon: ShieldCheck,
    critical: true,
    hint: "Production accepts challenge tokens only from the configured Vercel and Fly hostnames.",
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
  {
    key: "website_integration_configured",
    label: "Customer Hub connection",
    icon: Server,
    critical: true,
    hint: "The private signed draft destination and dealership guard must be fully configured.",
  },
];

/**
 * Super-admin system health surface. Pings /api/app/health and renders a
 * one-line status strip: healthy systems stay out of the way, failing checks
 * surface themselves, and full diagnostics live behind the Details
 * disclosure. First stop when debugging a production issue.
 */
export const SystemHealthPanel: React.FC = () => {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    const requestAuthEpoch = captureAuthEpoch();
    setLoading(true);
    setError(null);
    let res: Response;
    try {
      assertAuthEpoch(requestAuthEpoch);
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

    if (res.status === 401) {
      const authError = await readApiError(res, { requestAuthEpoch });
      setData(null);
      setLastChecked(null);
      setError(authError.message);
      setLoading(false);
      return;
    }

    let body: unknown;
    try {
      body = await res.json();
      assertAuthEpoch(requestAuthEpoch);
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
  const advisories = checkRows.filter(
    (r) => !r.critical && data && !data.checks[r.key],
  );

  // One truthful headline: criticals win, then the endpoint's own verdict,
  // then advisories. "All systems operational" can never share the strip
  // with a critical list.
  const status = !data
    ? ("loading" as const)
    : criticalFailures.length > 0 || !overallOk
      ? ("critical" as const)
      : advisories.length > 0
        ? ("advisory" as const)
        : ("operational" as const);

  const headline =
    status === "loading"
      ? "Checking system health…"
      : status === "critical"
        ? `${Math.max(criticalFailures.length, 1)} critical ${
            criticalFailures.length === 1 ? "issue needs" : "issues need"
          } attention`
        : status === "advisory"
          ? `Operational — ${advisories.length} ${
              advisories.length === 1 ? "advisory" : "advisories"
            }`
          : "All systems operational";

  // Only criticals interrupt; advisories are counted in the headline and
  // live in the Details disclosure with everything else.
  const failingRows = criticalFailures;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-hairline bg-surface-overlay"
    >
      {/* Status strip — the only part most sessions ever need. */}
      <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            status === "loading" && "bg-surface-500 animate-pulse",
            status === "operational" && "bg-success-500",
            status === "advisory" && "bg-warning-500",
            status === "critical" && "bg-error-500",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-content-primary">
            {headline}
          </h3>
          <p className="truncate text-xs text-content-tertiary">
            {lastChecked
              ? `Checked ${lastChecked.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · refreshes every minute`
              : "Contacting the health endpoint…"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh system health"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          rightIcon={
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-[var(--duration-base)]",
                expanded && "rotate-180",
              )}
            />
          }
        >
          Details
        </Button>
      </div>

      {error && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-md border border-error-500/40 bg-error-500/10 px-3 py-2 text-xs text-error-300 sm:mx-5">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Failing checks surface themselves; healthy ones stay behind Details. */}
      {failingRows.length > 0 && (
        <ul className="border-t border-hairline px-4 py-2 sm:px-5">
          {failingRows.map((row) => (
            <li key={row.key} className="flex items-start gap-2.5 py-1.5">
              <XCircle
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  row.critical ? "text-error-400" : "text-warning-400",
                )}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <span className="text-sm font-medium text-content-primary">
                  {row.label}
                </span>
                <span className="ml-2 text-xs text-content-tertiary">{row.hint}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {expanded && (
        <div className="space-y-4 border-t border-hairline px-4 py-4 sm:px-5">
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {checkRows.map((row) => {
              const ok = data ? data.checks[row.key] : null;
              return (
                <div
                  key={row.key}
                  title={row.hint}
                  className="flex items-center gap-2.5 border-b border-hairline/60 py-2"
                >
                  {ok === true && (
                    <CheckCircle2
                      className="h-3.5 w-3.5 shrink-0 text-success-500"
                      aria-hidden="true"
                    />
                  )}
                  {ok === false && (
                    <XCircle
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        row.critical ? "text-error-400" : "text-warning-400",
                      )}
                      aria-hidden="true"
                    />
                  )}
                  {ok === null && (
                    <Loader2
                      className="h-3.5 w-3.5 shrink-0 animate-spin text-content-tertiary"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate text-sm text-content-secondary">
                    {row.label}
                  </span>
                  <span className="sr-only">
                    {ok === true ? "passing" : ok === false ? "failing" : "checking"}
                  </span>
                </div>
              );
            })}
          </div>

          {data?.counts ? (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Dealers" value={data.counts.dealers} />
              <Stat label="Posts (24h)" value={data.counts.posts_24h} />
              <Stat label="Releases (24h)" value={data.counts.photo_releases_24h} />
            </div>
          ) : data ? (
            <div className="rounded-md border border-hairline px-3 py-2 text-xs text-content-tertiary">
              Activity counts are unavailable from this health endpoint.
            </div>
          ) : null}

          {data ? (
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
              <section className="rounded-md border border-hairline p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-content-tertiary">
                      Release contract
                    </p>
                    <p className="mt-1 font-mono text-xs text-content-secondary">
                      {data.releaseSha === "unknown"
                        ? "Release SHA unavailable"
                        : data.releaseSha.slice(0, 16)}
                    </p>
                  </div>
                  <span className="rounded-full border border-hairline bg-fill-subtle px-2.5 py-1 text-[10px] font-semibold text-content-secondary">
                    API {data.apiContractVersion}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-content-tertiary">
                  <span>Health v{data.version}</span>
                  <span aria-hidden="true">·</span>
                  <span>Model policy v{data.modelPolicyVersion}</span>
                </div>
              </section>

              <section className="rounded-md border border-hairline p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-content-tertiary">
                  Recovery readiness
                </p>
                <p
                  className={cn(
                    "mt-1 text-sm font-semibold",
                    data.backup.status === "verified"
                      ? "text-success-500"
                      : "text-warning-500",
                  )}
                >
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
                <p className="mt-1 text-xs text-content-tertiary">
                  {data.backup.lastVerifiedAt
                    ? `Last verified ${new Date(data.backup.lastVerifiedAt).toLocaleString()}`
                    : "No verified restore timestamp is available for this release."}
                </p>
                <p className="mt-1 text-[11px] text-content-tertiary">
                  Evidence expires after {data.backup.maxAgeHours} hours and must match
                  this release SHA.
                </p>
              </section>
            </div>
          ) : null}

          {data?.generation ? (
            <section className="space-y-3 rounded-md border border-hairline p-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-content-tertiary">
                    Generation · last 24 hours
                  </p>
                  <p className="mt-1 text-sm text-content-secondary">
                    Provider results and clearly labeled safe-template fallbacks.
                  </p>
                </div>
                <p className="text-xs text-content-tertiary">
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
            <section className="rounded-md border border-hairline p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-content-tertiary">
                    Actionable client errors · 24 hours
                  </p>
                  <p className="mt-1 text-sm text-content-secondary">
                    Redacted aggregates only; retained for 14 days.
                  </p>
                </div>
                <span className="text-2xl font-bold tabular-nums text-content-primary">
                  {data.recentErrors.total24h}
                </span>
              </div>
              {data.recentErrors.topActions.length > 0 ? (
                <ul className="mt-3 divide-y divide-hairline text-xs">
                  {data.recentErrors.topActions.map((action) => (
                    <li
                      key={action.name}
                      className="flex items-center justify-between gap-3 py-2 text-content-secondary"
                    >
                      <code className="min-w-0 truncate">{action.name}</code>
                      <span className="font-semibold tabular-nums text-content-primary">
                        {action.count}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-success-500">
                  No redacted client errors recorded in this window.
                </p>
              )}
            </section>
          ) : null}
        </div>
      )}
    </motion.div>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-md border border-hairline px-3 py-2 text-center">
    <div className="text-2xl font-bold tabular-nums text-content-primary">{value}</div>
    <div className="text-[10px] uppercase tracking-wide text-content-tertiary">
      {label}
    </div>
  </div>
);

const MiniStat: React.FC<{
  label: string;
  value: number;
  warning?: boolean;
}> = ({ label, value, warning = false }) => (
  <div
    className={cn(
      "rounded-md border px-3 py-2",
      warning ? "border-warning-500/40" : "border-hairline",
    )}
  >
    <div
      className={cn(
        "text-lg font-bold tabular-nums",
        warning ? "text-warning-500" : "text-content-primary",
      )}
    >
      {value}
    </div>
    <div className="text-[9px] font-semibold uppercase tracking-wide text-content-tertiary">
      {label}
    </div>
  </div>
);
