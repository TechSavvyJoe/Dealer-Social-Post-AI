import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script";
const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const DEVELOPMENT_TEST_SITE_KEY = "1x00000000000000000000AA";

interface TurnstileChallengeProps {
  onToken: (token: string) => void;
  onExpired?: () => void;
  onError?: () => void;
  /** Returns to the still-populated sign-in form so the user can correct it. */
  onBack?: () => void;
}

const configuredSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export const TurnstileChallenge: React.FC<TurnstileChallengeProps> = ({
  onToken,
  onExpired,
  onError,
  onBack,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onToken, onExpired, onError });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const siteKey =
    configuredSiteKey || (import.meta.env.DEV ? DEVELOPMENT_TEST_SITE_KEY : "");

  useEffect(() => {
    callbacksRef.current = { onToken, onExpired, onError };
  }, [onError, onExpired, onToken]);

  useEffect(() => {
    let cancelled = false;

    const renderWidget = () => {
      if (
        cancelled ||
        !containerRef.current ||
        !siteKey ||
        !window.turnstile ||
        widgetIdRef.current
      ) {
        return;
      }

      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: "turnstile-spin-v2",
          theme: "dark",
          size: "flexible",
          callback: (token) => {
            setIsLoading(false);
            setLoadError(false);
            setIsExpired(false);
            callbacksRef.current.onToken(token);
          },
          "expired-callback": () => {
            setIsLoading(false);
            setIsExpired(true);
            callbacksRef.current.onExpired?.();
          },
          "error-callback": () => {
            setIsLoading(false);
            setLoadError(true);
            callbacksRef.current.onError?.();
          },
        });
        setIsLoading(false);
      } catch {
        setIsLoading(false);
        setLoadError(true);
        callbacksRef.current.onError?.();
      }
    };

    if (!siteKey) {
      setIsLoading(false);
      setLoadError(true);
      callbacksRef.current.onError?.();
      return;
    }

    if (window.turnstile) {
      renderWidget();
    } else {
      let script = document.getElementById(
        TURNSTILE_SCRIPT_ID,
      ) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.id = TURNSTILE_SCRIPT_ID;
        script.src = TURNSTILE_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", renderWidget);
      script.addEventListener("error", () => {
        if (cancelled) return;
        setIsLoading(false);
        setLoadError(true);
        callbacksRef.current.onError?.();
      });
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [attempt, siteKey]);

  const retry = () => {
    setLoadError(false);
    setIsExpired(false);
    setIsLoading(true);

    // A failed script element will never emit another load event. Remove it so
    // a retry performs a real network attempt instead of waiting forever.
    if (!window.turnstile) {
      document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
    }
    setAttempt((current) => current + 1);
  };

  return (
    <div className="rounded-2xl border border-primary-400/20 bg-primary-500/[0.06] p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary-400/20 bg-primary-500/10 text-primary-300">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold text-surface-100">Security check</h2>
          <p className="mt-1 text-sm leading-relaxed text-surface-400">
            Complete this quick check, then we’ll verify the same sign-in details.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div
          className="flex min-h-16 items-center justify-center gap-2 text-sm text-surface-400"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading secure verification…
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="cf-turnstile min-h-0 w-full"
        data-action="turnstile-spin-v2"
      />
      {loadError ? (
        <p className="mt-3 text-sm text-error-300" role="alert">
          The security check could not load. Check your connection and try again.
        </p>
      ) : null}
      {isExpired && !loadError ? (
        <p className="mt-3 text-sm text-warning-200" role="alert">
          This security check expired before sign-in finished. Run it again to continue.
        </p>
      ) : null}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-surface-300 transition-colors hover:bg-white/5 hover:text-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Edit sign-in details
          </button>
        ) : null}
        {loadError || isExpired ? (
          <button
            type="button"
            onClick={retry}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary-400/30 bg-primary-500/15 px-4 text-sm font-semibold text-primary-100 transition-colors hover:bg-primary-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry security check
          </button>
        ) : null}
      </div>
    </div>
  );
};
