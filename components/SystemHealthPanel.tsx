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
  };
  counts?: {
    dealers: number;
    posts_24h: number;
    photo_releases_24h: number;
  };
  version: string;
}

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
    key: "proxy_token_set",
    label: "Proxy access token",
    icon: ShieldCheck,
    critical: false,
    hint: "Optional server-to-server proxy hardening. Browser access no longer requires PROXY_ACCESS_TOKEN.",
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
    hint: "Required for super-admin login; must be 6-12 alphanumeric characters.",
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
    try {
      const res = await fetch("/api/app/health", { credentials: "include" });
      if (!res.ok) throw new Error(`/api/app/health ${res.status}`);
      const body = (await res.json()) as HealthPayload;
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
          <strong>Critical:</strong>{" "}
          {criticalFailures.map((c) => c.label).join(", ")} — fix before users
          hit the app.
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
                ok === false &&
                  row.critical &&
                  "border-error-500/40 bg-error-500/5",
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
                <div className="text-sm font-semibold text-surface-50">
                  {row.label}
                </div>
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
    </motion.div>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-xl border border-surface-800 bg-surface-900/40 px-3 py-2 text-center">
    <div className="text-2xl font-bold text-surface-50 tabular-nums">
      {value}
    </div>
    <div className="text-[10px] uppercase tracking-wide text-surface-400">
      {label}
    </div>
  </div>
);
