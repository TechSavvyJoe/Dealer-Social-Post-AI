import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { Logo } from "./Logo";
import { triggerHapticFeedback } from "../utils/haptics";
import { Dialpad, type DialpadKey } from "./Dialpad";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { cn } from "../utils/classNames";
import { TurnstileChallenge } from "./TurnstileChallenge";
import type { LoginResult, SessionLoginRequest } from "../stores/appStore";

/** Personal manager / user access codes are exactly 4 digits. */
const PERSON_CODE_LENGTH = 4;
/** Manager and administrator passwords are 8-128 exact characters. */
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

interface LoginScreenProps {
  onLogin: (
    credentials: SessionLoginRequest,
    turnstileToken?: string,
  ) => Promise<LoginResult>;
}

type EntryMode = "personal" | "manager" | "system";
type ManagerErrorTarget = "username" | "password" | "credentials" | null;

const STUDIO_STEPS = [
  { label: "Capture", detail: "Start with the vehicle", icon: Camera },
  { label: "Shape", detail: "Build the right story", icon: WandSparkles },
  { label: "Share", detail: "Publish with confidence", icon: ArrowRight },
] as const;

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [entryMode, setEntryMode] = useState<EntryMode>("personal");
  const [dealerCode, setDealerCode] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [managerUsername, setManagerUsername] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [showManagerPassword, setShowManagerPassword] = useState(false);
  const [pendingAttempt, setPendingAttempt] = useState<EntryMode | null>(null);
  const [challengeNonce, setChallengeNonce] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [personalCodeError, setPersonalCodeError] = useState("");
  const [adminLoginError, setAdminLoginError] = useState("");
  const [adminErrorTarget, setAdminErrorTarget] = useState<ManagerErrorTarget>(null);
  const [managerLoginError, setManagerLoginError] = useState("");
  const [managerErrorTarget, setManagerErrorTarget] =
    useState<ManagerErrorTarget>(null);
  const adminUsernameRef = useRef<HTMLInputElement>(null);
  const adminPasswordRef = useRef<HTMLInputElement>(null);
  const managerUsernameRef = useRef<HTMLInputElement>(null);
  const managerPasswordRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const shouldReduceMotion = useReducedMotion();
  const toast = useToast();

  useEffect(() => {
    // A successful login updates the global store and can immediately unmount
    // this screen while the short success transition is still resolving.
    // Keep late async continuations from scheduling work on a retired tree.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const submitCredentials = useCallback(
    async (
      credentials: SessionLoginRequest,
      mode: EntryMode,
      turnstileToken?: string,
    ) => {
      if (isLoading || isSuccess || lockoutUntil > Date.now()) {
        return;
      }

      setIsLoading(true);
      try {
        const result = await onLogin(credentials, turnstileToken);
        if (!isMountedRef.current) return;
        if (result.ok) {
          setPendingAttempt(null);
          setManagerPassword("");
          setAdminPassword("");
          setIsSuccess(true);
          toast.success("Access confirmed.");
          await new Promise((resolve) =>
            setTimeout(resolve, shouldReduceMotion ? 150 : 650),
          );
        } else {
          switch (result.code) {
            case "CHALLENGE_REQUIRED":
              setPendingAttempt(mode);
              if (turnstileToken) {
                // Tokens are single-use. Guarantee a fresh widget even when
                // React batches the loading state around a fast rejection.
                setChallengeNonce((current) => current + 1);
              }
              toast.info("Complete the security check to continue.");
              break;
            case "LOCKED": {
              const retryAfter = Math.max(1, result.retryAfterSeconds || 900);
              setPendingAttempt(null);
              setManagerPassword("");
              setAdminPassword("");
              setClockNow(Date.now());
              setLockoutUntil(Date.now() + retryAfter * 1000);
              toast.error("Sign-in is temporarily locked.");
              break;
            }
            case "INVALID_CODE":
            case "INVALID_CREDENTIALS":
              setPendingAttempt(null);
              if (mode === "personal") {
                setDealerCode("");
                setPersonalCodeError(
                  "Code not recognized. Check the code and try again.",
                );
              } else if (mode === "manager") {
                setManagerPassword("");
                setManagerLoginError(
                  "Username or password not recognized. Check both and try again.",
                );
                setManagerErrorTarget("credentials");
                requestAnimationFrame(() => managerPasswordRef.current?.focus());
              } else {
                setAdminPassword("");
                setAdminLoginError(
                  "Username or password not recognized. Check both and try again.",
                );
                setAdminErrorTarget("credentials");
                requestAnimationFrame(() => adminPasswordRef.current?.focus());
              }
              break;
            default:
              if (turnstileToken) {
                setChallengeNonce((current) => current + 1);
              }
              toast.error(
                result.message ||
                  "The secure sign-in service is unavailable. Try again.",
              );
          }
        }
      } catch {
        if (turnstileToken) {
          setChallengeNonce((current) => current + 1);
        }
        toast.error(
          "We could not verify this code. Check your connection and try again.",
        );
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [isLoading, isSuccess, lockoutUntil, onLogin, shouldReduceMotion, toast],
  );

  const submitCode = useCallback(
    async (codeToSubmit: string, turnstileToken?: string) => {
      const normalizedCode = codeToSubmit.trim();
      if (normalizedCode.length !== PERSON_CODE_LENGTH) {
        if (normalizedCode.length > 0) {
          toast.info("Enter your 4-digit access code.");
        }
        return;
      }
      await submitCredentials(
        { authType: "code", dealerCode: normalizedCode },
        "personal",
        turnstileToken,
      );
    },
    [submitCredentials, toast],
  );

  const submitManagerLogin = useCallback(
    async (turnstileToken?: string) => {
      const normalizedUsername = managerUsername.trim().toLowerCase();
      if (!/^[a-z][a-z0-9._-]{2,31}$/.test(normalizedUsername)) {
        setManagerLoginError(
          "Enter the manager username provided by your system administrator.",
        );
        setManagerErrorTarget("username");
        managerUsernameRef.current?.focus();
        return;
      }
      if (
        managerPassword.length < MIN_PASSWORD_LENGTH ||
        managerPassword.length > MAX_PASSWORD_LENGTH
      ) {
        setManagerLoginError("Enter the complete manager password.");
        setManagerErrorTarget("password");
        managerPasswordRef.current?.focus();
        return;
      }
      setManagerLoginError("");
      setManagerErrorTarget(null);
      await submitCredentials(
        {
          authType: "manager_password",
          username: normalizedUsername,
          password: managerPassword,
        },
        "manager",
        turnstileToken,
      );
    },
    [managerPassword, managerUsername, submitCredentials],
  );

  const submitAdminLogin = useCallback(
    async (turnstileToken?: string) => {
      const normalizedUsername = adminUsername.trim().toLowerCase();
      if (!/^[a-z][a-z0-9._-]{2,31}$/.test(normalizedUsername)) {
        setAdminLoginError("Enter the administrator username.");
        setAdminErrorTarget("username");
        adminUsernameRef.current?.focus();
        return;
      }
      if (
        adminPassword.length < MIN_PASSWORD_LENGTH ||
        adminPassword.length > MAX_PASSWORD_LENGTH
      ) {
        setAdminLoginError("Enter the complete administrator password.");
        setAdminErrorTarget("password");
        adminPasswordRef.current?.focus();
        return;
      }
      setAdminLoginError("");
      setAdminErrorTarget(null);
      await submitCredentials(
        {
          authType: "admin_password",
          username: normalizedUsername,
          password: adminPassword,
        },
        "system",
        turnstileToken,
      );
    },
    [adminPassword, adminUsername, submitCredentials],
  );

  const lockoutSeconds = Math.max(0, Math.ceil((lockoutUntil - clockNow) / 1000));

  useEffect(() => {
    if (!lockoutUntil) return;
    const interval = window.setInterval(() => {
      const next = Date.now();
      setClockNow(next);
      if (next >= lockoutUntil) {
        setLockoutUntil(0);
        window.clearInterval(interval);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [lockoutUntil]);

  const handleDialpadKeyPress = useCallback(
    async (key: DialpadKey) => {
      triggerHapticFeedback();
      if (isLoading || isSuccess) return;
      setPersonalCodeError("");

      if (key === "clear") {
        setDealerCode("");
        return;
      }

      const nextCode =
        key === "backspace"
          ? dealerCode.slice(0, -1)
          : dealerCode.length < PERSON_CODE_LENGTH
            ? `${dealerCode}${key}`
            : dealerCode;

      setDealerCode(nextCode);
      if (nextCode.length === PERSON_CODE_LENGTH) {
        await submitCode(nextCode);
      }
    },
    [dealerCode, isLoading, isSuccess, submitCode],
  );

  const selectMode = useCallback((mode: EntryMode) => {
    triggerHapticFeedback();
    if (mode !== "manager") {
      setManagerPassword("");
      setShowManagerPassword(false);
    }
    if (mode !== "system") {
      setAdminPassword("");
      setShowAdminPassword(false);
    }
    setEntryMode(mode);
    setPendingAttempt(null);
    setPersonalCodeError("");
    setAdminLoginError("");
    setAdminErrorTarget(null);
    setManagerLoginError("");
    setManagerErrorTarget(null);
  }, []);

  const returnToCodeEntry = useCallback(() => {
    if (!pendingAttempt) return;
    setEntryMode(pendingAttempt);
    setPendingAttempt(null);
    setPersonalCodeError("");
    setAdminLoginError("");
    setAdminErrorTarget(null);
    setManagerLoginError("");
    setManagerErrorTarget(null);
  }, [pendingAttempt]);

  useEffect(() => {
    if (isLoading || isSuccess) return;
    const frame = requestAnimationFrame(() => {
      if (entryMode === "system") adminUsernameRef.current?.focus();
      if (entryMode === "manager") managerUsernameRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [entryMode, isLoading, isSuccess]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isInteractiveTarget =
        target instanceof Element &&
        (target.closest(
          'input, textarea, select, button, a[href], [role="button"], [role="tab"], [contenteditable="true"]',
        ) ||
          (target instanceof HTMLElement && target.isContentEditable));
      if (isInteractiveTarget || isLoading || isSuccess) {
        return;
      }

      if (pendingAttempt) {
        if (event.key === "Escape") {
          event.preventDefault();
          returnToCodeEntry();
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        if (entryMode === "manager") {
          void submitManagerLogin();
        } else if (entryMode === "system") {
          void submitAdminLogin();
        } else {
          void submitCode(dealerCode);
        }
      } else if (event.key === "Backspace" && entryMode === "personal") {
        event.preventDefault();
        void handleDialpadKeyPress("backspace");
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (entryMode === "system") setAdminPassword("");
        if (entryMode === "manager") setManagerPassword("");
        if (entryMode === "personal") setDealerCode("");
      } else if (entryMode === "personal" && /^\d$/.test(event.key)) {
        event.preventDefault();
        void handleDialpadKeyPress(event.key as DialpadKey);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    dealerCode,
    entryMode,
    handleDialpadKeyPress,
    isLoading,
    isSuccess,
    pendingAttempt,
    returnToCodeEntry,
    submitAdminLogin,
    submitCode,
    submitManagerLogin,
  ]);

  const motionTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <m.section
      className="relative mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col"
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTransition}
      aria-label="Dealer access"
    >
      <div
        className={cn(
          "relative grid h-full min-h-0 w-full flex-1 border border-hairline bg-surface-base shadow-lg",
          // Fill the #root content box only — never max-h 100dvh (that fights safe-area)
          "overflow-hidden rounded-none border-x-0",
          "min-[420px]:mx-2 min-[420px]:rounded-2xl min-[420px]:border-x",
          "sm:mx-0 sm:rounded-[1.5rem]",
          "lg:h-auto lg:min-h-[38rem] lg:grid-cols-[minmax(0,1.08fr)_minmax(23rem,0.92fr)]",
        )}
      >
        <div
          className="absolute inset-x-0 top-0 z-20 h-px bg-[var(--brand-primary)] opacity-80"
          aria-hidden="true"
        />

        <aside className="relative hidden min-h-[38rem] overflow-hidden border-r border-hairline bg-surface-elevated p-10 lg:flex lg:flex-col">
          <Logo className="relative z-10 h-auto w-[250px]" />

          <div
            className="absolute right-10 top-24 h-64 w-52 border border-hairline"
            aria-hidden="true"
          >
            <span className="absolute -left-px -top-px h-10 w-10 border-l-2 border-t-2 border-primary-400/75" />
            <span className="absolute -right-px -top-px h-10 w-10 border-r-2 border-t-2 border-primary-400/75" />
            <span className="absolute -bottom-px -left-px h-10 w-10 border-b-2 border-l-2 border-primary-400/75" />
            <span className="absolute -bottom-px -right-px h-10 w-10 border-b-2 border-r-2 border-primary-400/75" />
            <span className="absolute left-4 top-4 font-mono text-[10px] tracking-[0.18em] text-surface-400">
              4:5 · FEED
            </span>
            <span className="absolute bottom-4 right-4 h-2 w-2 rounded-full bg-success-400" />
          </div>

          <div className="relative z-10 mt-auto max-w-[29rem]">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-primary-300">
              Built for the showroom floor
            </p>
            <p className="max-w-[25rem] text-[2.7rem] font-semibold leading-[1.02] tracking-[-0.045em] text-surface-50">
              From vehicle photo to social-ready story.
            </p>
            <p className="mt-5 max-w-md text-base leading-relaxed text-surface-300">
              A focused workspace for dealership teams to create polished posts while
              the delivery moment is still fresh.
            </p>

            <ol className="mt-8 grid grid-cols-3 gap-3 border-t border-hairline pt-5">
              {STUDIO_STEPS.map(({ label, detail, icon: StepIcon }, index) => (
                <li key={label} className="min-w-0">
                  <div className="mb-2 flex items-center gap-2 text-primary-300">
                    <StepIcon className="h-4 w-4" aria-hidden="true" />
                    <span className="font-mono text-[10px] tabular-nums">
                      0{index + 1}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-surface-100">{label}</p>
                  <p className="mt-0.5 text-xs leading-snug text-surface-400">
                    {detail}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        {/* Right pane: CSS grid — fixed chrome + fluid keypad (no page scroll) */}
        <div
          className={cn(
            "login-access-pane grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)]",
            "px-5 pt-4 pb-3 sm:px-8 sm:pt-7 sm:pb-6 lg:min-h-[38rem] lg:px-10 lg:py-8",
          )}
          aria-busy={isLoading}
        >
          <Logo className="login-mobile-logo mb-3 h-auto w-[min(188px,50vw)] shrink-0 justify-self-start lg:hidden" />

          <AnimatePresence mode="wait">
            {isSuccess ? (
              <m.div
                key="success"
                className="flex min-h-0 flex-col items-center justify-center text-center"
                initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={motionTransition}
                role="status"
                aria-live="polite"
              >
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-success-500/35 bg-success-500/10">
                  <CheckCircle2
                    className="h-8 w-8 text-success-400"
                    aria-hidden="true"
                  />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-surface-50">
                  Access confirmed
                </h1>
                <p className="mt-2 text-sm text-surface-400">
                  Opening your dealership workspace.
                </p>
              </m.div>
            ) : isLoading ? (
              <m.div
                key="loading"
                className="flex min-h-0 flex-col items-center justify-center text-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={motionTransition}
                role="status"
              >
                <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-primary-500/30 bg-primary-500/10">
                  <Loader2
                    className="h-7 w-7 animate-spin text-primary-300"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-5 text-base font-semibold text-surface-100">
                  Verifying access
                </p>
                <p className="mt-1 text-sm text-surface-400">
                  Connecting to your dealership workspace.
                </p>
              </m.div>
            ) : (
              <m.div
                key="login-form"
                className="login-form grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 sm:gap-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={motionTransition}
              >
                <div className="flex shrink-0 items-start gap-3">
                  <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-hairline bg-fill-subtle">
                    <ShieldCheck
                      className="h-5 w-5 text-primary-300"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="min-w-0">
                    <h1
                      id="login-heading"
                      className="text-2xl font-semibold tracking-[-0.025em] text-surface-50 sm:text-3xl"
                    >
                      Sign in
                    </h1>
                    <p className="mt-1 text-sm leading-snug text-surface-300 sm:mt-1.5 sm:text-base sm:leading-relaxed">
                      {entryMode === "personal"
                        ? "Tap your 4-digit code. We sign you in automatically."
                        : entryMode === "manager"
                          ? "Use your dealership manager username and password."
                          : "Use your system administrator username and password."}
                    </p>
                  </div>
                </div>

                <div
                  className="grid shrink-0 grid-cols-3 gap-1 rounded-2xl border border-hairline bg-fill-hover p-1.5"
                  role="group"
                  aria-label="Access type"
                >
                  <button
                    type="button"
                    onClick={() => selectMode("personal")}
                    aria-pressed={entryMode === "personal"}
                    className={cn(
                      "min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors sm:min-h-12",
                      entryMode === "personal"
                        ? "bg-primary-600 text-white shadow-md"
                        : "text-surface-300 hover:text-surface-100",
                    )}
                  >
                    My code
                  </button>
                  <button
                    type="button"
                    onClick={() => selectMode("manager")}
                    aria-pressed={entryMode === "manager"}
                    aria-label="Manager username and password"
                    className={cn(
                      "min-h-11 rounded-xl px-2 text-xs font-semibold transition-colors sm:min-h-12 sm:px-3 sm:text-sm",
                      entryMode === "manager"
                        ? "bg-primary-600 text-white shadow-md"
                        : "text-surface-300 hover:text-surface-100",
                    )}
                  >
                    Manager
                  </button>
                  <button
                    type="button"
                    onClick={() => selectMode("system")}
                    aria-pressed={entryMode === "system"}
                    aria-label="System admin"
                    className={cn(
                      "min-h-11 rounded-xl px-2 text-xs font-semibold transition-colors sm:min-h-12 sm:px-3 sm:text-sm",
                      entryMode === "system"
                        ? "bg-primary-600 text-white shadow-md"
                        : "text-surface-300 hover:text-surface-100",
                    )}
                  >
                    System
                  </button>
                </div>

                {lockoutSeconds > 0 ? (
                  <div className="flex min-h-0 flex-col items-center justify-center rounded-2xl border border-error-400/20 bg-error-500/[0.07] p-5 text-center">
                    <p className="sr-only" role="alert">
                      Sign-in is temporarily locked. Try again after the on-screen
                      countdown.
                    </p>
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-error-400/25 bg-error-500/10 text-error-300">
                      <ShieldAlert className="h-6 w-6" aria-hidden="true" />
                    </span>
                    <h2 className="mt-4 text-lg font-semibold text-surface-100">
                      Sign-in temporarily locked
                    </h2>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-surface-400">
                      Too many unsuccessful attempts. You can try again in
                      <time
                        dateTime={`PT${lockoutSeconds}S`}
                        className="ml-1 font-mono font-semibold tabular-nums text-surface-100"
                      >
                        {Math.floor(lockoutSeconds / 60)}:
                        {String(lockoutSeconds % 60).padStart(2, "0")}
                      </time>
                      .
                    </p>
                  </div>
                ) : pendingAttempt ? (
                  <TurnstileChallenge
                    key={`turnstile-${challengeNonce}`}
                    onToken={(token) => {
                      if (pendingAttempt === "manager") {
                        void submitManagerLogin(token);
                      } else if (pendingAttempt === "system") {
                        void submitAdminLogin(token);
                      } else {
                        void submitCode(dealerCode, token);
                      }
                    }}
                    onExpired={() =>
                      toast.info("Security check expired. Complete it again.")
                    }
                    onError={() =>
                      toast.error(
                        "The security check could not load. Check your connection.",
                      )
                    }
                    onBack={returnToCodeEntry}
                  />
                ) : entryMode === "personal" ? (
                  <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-2 sm:gap-3">
                    <div
                      className="flex shrink-0 items-center justify-center gap-4 py-1"
                      role="status"
                      aria-label={`${dealerCode.length} of ${PERSON_CODE_LENGTH} digits entered`}
                    >
                      {/* Live regions announce text-content changes, not attribute
                          changes — this hidden text gives VoiceOver per-digit feedback
                          while aria-label keeps the region's accessible name stable. */}
                      <span className="sr-only">
                        {`${dealerCode.length} of ${PERSON_CODE_LENGTH} digits entered`}
                      </span>
                      {Array.from({ length: PERSON_CODE_LENGTH }, (_, index) => (
                        <span
                          key={index}
                          aria-hidden="true"
                          className={cn(
                            "h-4 w-4 rounded-full border-2 transition-colors sm:h-5 sm:w-5",
                            index < dealerCode.length
                              ? "border-primary-400 bg-primary-400"
                              : index === dealerCode.length
                                ? "border-primary-400 bg-transparent ring-4 ring-primary-500/15"
                                : "border-surface-600 bg-surface-800",
                          )}
                        />
                      ))}
                    </div>

                    <p
                      className={cn(
                        "shrink-0 text-center text-sm",
                        personalCodeError ? "text-error-300" : "text-surface-400",
                      )}
                      role={personalCodeError ? "alert" : undefined}
                    >
                      {personalCodeError ||
                        (dealerCode.length > 0
                          ? `${PERSON_CODE_LENGTH - dealerCode.length} left`
                          : "4 digits · from your manager")}
                    </p>

                    <div className="min-h-0 w-full">
                      <Dialpad onKeyPress={handleDialpadKeyPress} />
                    </div>
                  </div>
                ) : entryMode === "manager" ? (
                  <form
                    className="flex min-h-0 flex-col justify-start overflow-y-auto overscroll-contain lg:justify-center"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitManagerLogin();
                    }}
                  >
                    <div className="rounded-2xl border border-hairline bg-surface-elevated p-4 sm:p-5">
                      <div className="mb-4 flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-300">
                          <KeyRound className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <div>
                          <h2 className="text-base font-semibold text-surface-100">
                            Dealership manager
                          </h2>
                          <p className="mt-1 text-sm leading-relaxed text-surface-400">
                            Your account opens only your dealership’s manager workspace.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <Input
                          ref={managerUsernameRef}
                          label="Username"
                          name="username"
                          value={managerUsername}
                          onChange={(event) => {
                            setManagerLoginError("");
                            setManagerErrorTarget(null);
                            setManagerUsername(event.target.value.slice(0, 32));
                          }}
                          leftIcon={<UserRound />}
                          autoComplete="username"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          inputMode="text"
                          enterKeyHint="next"
                          maxLength={32}
                          aria-invalid={
                            managerLoginError &&
                            (managerErrorTarget === "username" ||
                              managerErrorTarget === "credentials")
                              ? true
                              : undefined
                          }
                          aria-describedby={
                            managerLoginError &&
                            (managerErrorTarget === "username" ||
                              managerErrorTarget === "credentials")
                              ? "manager-login-error"
                              : undefined
                          }
                          fullWidth
                        />
                        <Input
                          ref={managerPasswordRef}
                          label="Password"
                          name="password"
                          value={managerPassword}
                          type={showManagerPassword ? "text" : "password"}
                          onChange={(event) => {
                            setManagerLoginError("");
                            setManagerErrorTarget(null);
                            setManagerPassword(event.target.value.slice(0, 128));
                          }}
                          leftIcon={<KeyRound />}
                          rightAction={
                            <button
                              type="button"
                              className="flex h-11 w-11 items-center justify-center rounded-lg text-surface-400 transition hover:bg-fill-subtle hover:text-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                              onClick={() => setShowManagerPassword((value) => !value)}
                              aria-label={
                                showManagerPassword
                                  ? "Hide manager password"
                                  : "Show manager password"
                              }
                            >
                              {showManagerPassword ? (
                                <EyeOff className="h-4 w-4" aria-hidden="true" />
                              ) : (
                                <Eye className="h-4 w-4" aria-hidden="true" />
                              )}
                            </button>
                          }
                          autoComplete="current-password"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          enterKeyHint="go"
                          maxLength={128}
                          aria-invalid={
                            managerLoginError &&
                            (managerErrorTarget === "password" ||
                              managerErrorTarget === "credentials")
                              ? true
                              : undefined
                          }
                          aria-describedby={
                            managerLoginError &&
                            (managerErrorTarget === "password" ||
                              managerErrorTarget === "credentials")
                              ? "manager-login-error"
                              : undefined
                          }
                          fullWidth
                        />
                      </div>

                      {managerLoginError ? (
                        <p
                          id="manager-login-error"
                          className="mt-2 px-1 text-sm text-error-300"
                          role="alert"
                        >
                          {managerLoginError}
                        </p>
                      ) : (
                        <p className="mt-2 px-1 text-xs text-surface-400">
                          Contact your system administrator if you need access reset.
                        </p>
                      )}

                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        fullWidth
                        className="mt-4 min-h-12 sm:min-h-14"
                        rightIcon={<ArrowRight className="h-4 w-4" />}
                      >
                        Continue to manager workspace
                      </Button>
                    </div>
                  </form>
                ) : (
                  <form
                    className="flex min-h-0 flex-col justify-start overflow-y-auto overscroll-contain lg:justify-center"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitAdminLogin();
                    }}
                  >
                    <div className="rounded-2xl border border-hairline bg-surface-elevated p-4 sm:p-5">
                      <div className="mb-4 flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-300">
                          <KeyRound className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <div>
                          <h2 className="text-base font-semibold text-surface-100">
                            System administrator
                          </h2>
                          <p className="mt-1 text-sm leading-relaxed text-surface-400">
                            Platform-owner access across every dealership.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <Input
                          ref={adminUsernameRef}
                          label="Username"
                          name="admin-username"
                          value={adminUsername}
                          onChange={(event) => {
                            setAdminLoginError("");
                            setAdminErrorTarget(null);
                            setAdminUsername(event.target.value.slice(0, 32));
                          }}
                          leftIcon={<UserRound />}
                          autoComplete="username"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          inputMode="text"
                          enterKeyHint="next"
                          maxLength={32}
                          aria-invalid={
                            adminLoginError &&
                            (adminErrorTarget === "username" ||
                              adminErrorTarget === "credentials")
                              ? true
                              : undefined
                          }
                          aria-describedby={
                            adminLoginError &&
                            (adminErrorTarget === "username" ||
                              adminErrorTarget === "credentials")
                              ? "admin-login-error"
                              : undefined
                          }
                          fullWidth
                        />
                        <Input
                          ref={adminPasswordRef}
                          label="Password"
                          name="admin-password"
                          value={adminPassword}
                          type={showAdminPassword ? "text" : "password"}
                          onChange={(event) => {
                            setAdminLoginError("");
                            setAdminErrorTarget(null);
                            setAdminPassword(
                              event.target.value.slice(0, MAX_PASSWORD_LENGTH),
                            );
                          }}
                          leftIcon={<KeyRound />}
                          rightAction={
                            <button
                              type="button"
                              className="flex h-11 w-11 items-center justify-center rounded-lg text-surface-400 transition hover:bg-fill-subtle hover:text-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                              onClick={() => setShowAdminPassword((value) => !value)}
                              aria-label={
                                showAdminPassword
                                  ? "Hide administrator password"
                                  : "Show administrator password"
                              }
                            >
                              {showAdminPassword ? (
                                <EyeOff className="h-4 w-4" aria-hidden="true" />
                              ) : (
                                <Eye className="h-4 w-4" aria-hidden="true" />
                              )}
                            </button>
                          }
                          autoComplete="current-password"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          enterKeyHint="go"
                          maxLength={MAX_PASSWORD_LENGTH}
                          aria-invalid={
                            adminLoginError &&
                            (adminErrorTarget === "password" ||
                              adminErrorTarget === "credentials")
                              ? true
                              : undefined
                          }
                          aria-describedby={
                            adminLoginError &&
                            (adminErrorTarget === "password" ||
                              adminErrorTarget === "credentials")
                              ? "admin-login-error"
                              : undefined
                          }
                          fullWidth
                        />
                      </div>

                      {adminLoginError ? (
                        <p
                          id="admin-login-error"
                          className="mt-2 px-1 text-sm text-error-300"
                          role="alert"
                        >
                          {adminLoginError}
                        </p>
                      ) : (
                        <p className="mt-2 px-1 text-xs text-surface-400">
                          Credentials come from your deployment secrets.
                        </p>
                      )}

                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        fullWidth
                        className="mt-4 min-h-12 sm:min-h-14"
                        rightIcon={<ArrowRight className="h-4 w-4" />}
                      >
                        Continue to system admin
                      </Button>
                    </div>
                  </form>
                )}
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </m.section>
  );
};
