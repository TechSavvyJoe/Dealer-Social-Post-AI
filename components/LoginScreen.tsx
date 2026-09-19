import React, { useCallback, useEffect, useRef, useState } from "react";
import { m, useReducedMotion } from "framer-motion";
import { CheckCircle2, Delete, Eye, EyeOff, Loader2 } from "lucide-react";
import { Logo } from "./Logo";
import { triggerHapticFeedback } from "../utils/haptics";
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
type KeypadKey =
  "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "backspace";

/**
 * Keypad layout (spec §5.1): a 3 x 4 grid. The last row leaves its first cell
 * empty so 0 stays under 8 exactly as on a phone dial.
 */
const KEYPAD_ROWS: readonly (readonly (KeypadKey | null)[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [null, "0", "backspace"],
];

/** Sentence-case labels for the three access modes (spec §4.8 login row). */
const MODES: readonly {
  mode: EntryMode;
  label: string;
  /** Accessible name pinned by e2e; omitted when the visible label is enough. */
  ariaLabel?: string;
}[] = [
  { mode: "personal", label: "My code" },
  { mode: "manager", label: "Manager", ariaLabel: "Manager username and password" },
  { mode: "system", label: "System", ariaLabel: "System admin" },
];

const segmentStyles = (selected: boolean) =>
  cn(
    "min-h-11 rounded-sm border px-2 text-sm font-semibold",
    "transition-colors duration-120 ease-out",
    selected
      ? "border-brand-fill bg-brand-fill text-brand-foreground"
      : "border-strong bg-panel-raised text-ink hover:bg-fill-hover",
  );

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

  const handleKeypadPress = useCallback(
    async (key: KeypadKey) => {
      triggerHapticFeedback();
      if (isLoading || isSuccess) return;
      setPersonalCodeError("");

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
        void handleKeypadPress("backspace");
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (entryMode === "system") setAdminPassword("");
        if (entryMode === "manager") setManagerPassword("");
        if (entryMode === "personal") setDealerCode("");
      } else if (entryMode === "personal" && /^\d$/.test(event.key)) {
        event.preventDefault();
        void handleKeypadPress(event.key as KeypadKey);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    dealerCode,
    entryMode,
    handleKeypadPress,
    isLoading,
    isSuccess,
    pendingAttempt,
    returnToCodeEntry,
    submitAdminLogin,
    submitCode,
    submitManagerLogin,
  ]);

  const digitsEntered = `${dealerCode.length} of ${PERSON_CODE_LENGTH} digits entered`;

  return (
    // The one moment on this screen (spec §4.4): the mark and the access panel
    // fade up 8px together, once per mount, 320ms. Nothing else animates.
    <m.section
      className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
      aria-label="Dealer access"
    >
      <div
        className={cn(
          "grid h-full min-h-0 w-full flex-1 grid-rows-[minmax(0,1fr)]",
          // Desktop: the pair fills the viewport height minus <main>'s lg:py-6
          // (App.tsx, 1.5rem top + bottom) so the panel's bottom edge and radius
          // stay inside that overflow-hidden scrollport; #root's own
          // safe-area/padding is zeroed out at this breakpoint (see index.html).
          // Capped and centred so it never stretches edge to edge on very wide
          // screens (spec §5.1).
          "lg:min-h-[calc(100dvh-3rem)] lg:max-w-[70rem] lg:mx-auto lg:grid-cols-12",
        )}
      >
        {/* Brand panel — desktop only, 5/12, full height. Login is the one
            screen with no photo and no dealership, so the product's own
            colour carries it (spec §5.1). */}
        <aside className="hidden bg-brand-fill p-10 text-brand-foreground lg:col-span-5 lg:flex lg:flex-col lg:justify-between">
          <Logo
            tone="onBrand"
            size={48}
            className="inline-flex items-center gap-3 self-start"
          />
          <div>
            <p className="max-w-[18rem] font-display text-4xl font-semibold leading-tight">
              Dealership photos, ready to post.
            </p>
            <p className="mt-4 max-w-[22rem] text-base text-brand-foreground opacity-75">
              Take the photo, pick the post, and share it to every channel in a minute.
            </p>
          </div>
        </aside>

        {/* Access panel — 7/12 on desktop, the whole screen on a phone. On
            lg+ its content is vertically centred within the full-height pane
            (spec §5.1); below lg the mobile single-column layout is
            untouched. */}
        <div
          className={cn(
            "login-access-pane grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)]",
            "px-4 py-4 sm:px-6 lg:col-span-7 lg:flex lg:flex-col lg:justify-center lg:px-10 lg:py-10",
          )}
          aria-busy={isLoading}
        >
          <Logo
            size={36}
            className="login-mobile-logo mb-5 inline-flex shrink-0 items-center gap-2.5 self-start lg:hidden"
          />

          {isSuccess ? (
            <div
              className="flex min-h-0 flex-col items-center justify-center text-center"
              role="status"
              aria-live="polite"
            >
              <CheckCircle2 className="h-8 w-8 text-ink" aria-hidden="true" />
              <h1 className="mt-4 font-display text-2xl font-semibold text-ink">
                Access confirmed
              </h1>
              <p className="mt-2 text-sm text-ink-2">
                Opening your dealership workspace.
              </p>
            </div>
          ) : isLoading ? (
            <div
              className="flex min-h-0 flex-col items-center justify-center text-center"
              role="status"
            >
              <Loader2 className="h-7 w-7 animate-spin text-ink-2" aria-hidden="true" />
              <p className="mt-4 text-base font-semibold text-ink">Verifying access</p>
              <p className="mt-1 text-sm text-ink-2">
                Connecting to your dealership workspace.
              </p>
            </div>
          ) : (
            // Exactly three children, in this order: the short-landscape layout
            // in styles/globals.css places them by :nth-child.
            <div className="login-form grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 lg:max-w-[28rem]">
              <h1
                id="login-heading"
                className="font-display text-3xl font-semibold text-ink sm:text-4xl"
              >
                Sign in
              </h1>

              <div
                className="grid shrink-0 grid-cols-3 gap-2"
                role="group"
                aria-label="Access type"
              >
                {MODES.map(({ mode, label, ariaLabel }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => selectMode(mode)}
                    aria-pressed={entryMode === mode}
                    aria-label={ariaLabel}
                    className={segmentStyles(entryMode === mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {lockoutSeconds > 0 ? (
                <div className="flex min-h-0 flex-col items-start justify-center rounded-md border border-hairline bg-panel p-5">
                  <p className="sr-only" role="alert">
                    Sign-in is temporarily locked. Try again after the on-screen
                    countdown.
                  </p>
                  <h2 className="text-lg font-semibold text-error-ink">
                    Sign-in temporarily locked
                  </h2>
                  <p className="mt-2 max-w-sm text-sm text-ink-2">
                    Too many unsuccessful attempts. You can try again in
                    <time
                      dateTime={`PT${lockoutSeconds}S`}
                      className="ml-1 font-display font-semibold tabular-nums text-ink"
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
                <div className="flex min-h-0 flex-col gap-2">
                  <div
                    className="flex shrink-0 items-center gap-3"
                    role="status"
                    aria-label={digitsEntered}
                  >
                    {/* Live regions announce text-content changes, not attribute
                        changes — this hidden text gives VoiceOver per-digit feedback
                        while aria-label keeps the region's accessible name stable. */}
                    <span className="sr-only">{digitsEntered}</span>
                    {Array.from({ length: PERSON_CODE_LENGTH }, (_, index) => (
                      <span
                        key={index}
                        aria-hidden="true"
                        className={cn(
                          "h-3.5 w-3.5 rounded-full border transition-colors duration-120 ease-out",
                          index < dealerCode.length
                            ? "border-brand-fill bg-brand-fill"
                            : "border-strong bg-transparent",
                        )}
                      />
                    ))}
                  </div>

                  <div
                    // Four 64px rows at their natural height (spec §4.6 `xl`):
                    // 280px total, so the keypad never stretches to fill a tall
                    // desktop column and never compresses below the touch target.
                    className="grid w-full max-w-[22rem] gap-2"
                    role="group"
                    aria-label="Four digit access code keypad"
                  >
                    {KEYPAD_ROWS.map((row, rowIndex) => (
                      <div key={rowIndex} className="grid grid-cols-3 gap-2">
                        {row.map((key, cellIndex) =>
                          key === null ? (
                            <span key={cellIndex} aria-hidden="true" />
                          ) : (
                            <Button
                              key={cellIndex}
                              type="button"
                              variant="key"
                              size="xl"
                              fullWidth
                              disableHaptics
                              aria-label={
                                key === "backspace"
                                  ? "Delete last digit"
                                  : `Digit ${key}`
                              }
                              onClick={() => void handleKeypadPress(key)}
                            >
                              {key === "backspace" ? (
                                <Delete className="h-6 w-6" aria-hidden="true" />
                              ) : (
                                key
                              )}
                            </Button>
                          ),
                        )}
                      </div>
                    ))}
                  </div>

                  <p
                    className={cn(
                      "shrink-0 text-caption",
                      personalCodeError ? "text-error-ink" : "text-ink-hint",
                    )}
                    role={personalCodeError ? "alert" : undefined}
                  >
                    {personalCodeError || "Enter your 4-digit code."}
                  </p>
                </div>
              ) : entryMode === "manager" ? (
                <form
                  className="flex min-h-0 flex-col justify-start gap-4 overflow-y-auto overscroll-contain"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitManagerLogin();
                  }}
                >
                  <div>
                    <h2 className="text-lg font-semibold text-ink">
                      Dealership manager
                    </h2>
                    <p className="mt-1 text-sm text-ink-2">
                      Use your dealership manager username and password.
                    </p>
                  </div>

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
                    rightAction={
                      <button
                        type="button"
                        className="flex h-11 w-11 items-center justify-center rounded-sm text-ink-2 transition-colors duration-120 ease-out hover:bg-fill-subtle hover:text-ink"
                        onClick={() => setShowManagerPassword((value) => !value)}
                        aria-label={
                          showManagerPassword
                            ? "Hide manager password"
                            : "Show manager password"
                        }
                      >
                        {showManagerPassword ? (
                          <EyeOff className="h-5 w-5" aria-hidden="true" />
                        ) : (
                          <Eye className="h-5 w-5" aria-hidden="true" />
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

                  {managerLoginError ? (
                    <p
                      id="manager-login-error"
                      className="text-caption text-error-ink"
                      role="alert"
                    >
                      {managerLoginError}
                    </p>
                  ) : (
                    <p className="text-caption text-ink-hint">
                      Contact your system administrator if you need access reset.
                    </p>
                  )}

                  <Button type="submit" variant="primary" size="lg" fullWidth>
                    Continue to manager workspace
                  </Button>
                </form>
              ) : (
                <form
                  className="flex min-h-0 flex-col justify-start gap-4 overflow-y-auto overscroll-contain"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAdminLogin();
                  }}
                >
                  <div>
                    <h2 className="text-lg font-semibold text-ink">
                      System administrator
                    </h2>
                    <p className="mt-1 text-sm text-ink-2">
                      Use your system administrator username and password.
                    </p>
                  </div>

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
                    rightAction={
                      <button
                        type="button"
                        className="flex h-11 w-11 items-center justify-center rounded-sm text-ink-2 transition-colors duration-120 ease-out hover:bg-fill-subtle hover:text-ink"
                        onClick={() => setShowAdminPassword((value) => !value)}
                        aria-label={
                          showAdminPassword
                            ? "Hide administrator password"
                            : "Show administrator password"
                        }
                      >
                        {showAdminPassword ? (
                          <EyeOff className="h-5 w-5" aria-hidden="true" />
                        ) : (
                          <Eye className="h-5 w-5" aria-hidden="true" />
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

                  {adminLoginError ? (
                    <p
                      id="admin-login-error"
                      className="text-caption text-error-ink"
                      role="alert"
                    >
                      {adminLoginError}
                    </p>
                  ) : (
                    <p className="text-caption text-ink-hint">
                      Credentials come from your deployment secrets.
                    </p>
                  )}

                  <Button type="submit" variant="primary" size="lg" fullWidth>
                    Continue to system admin
                  </Button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </m.section>
  );
};
