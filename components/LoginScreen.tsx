import {
  currentInvitedDealer,
  type InvitedDealer,
} from "../services/dealershipInvitations";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { m, useReducedMotion } from "framer-motion";
import { CheckCircle2, Delete, Eye, EyeOff, Loader2 } from "lucide-react";
import { Logo } from "./Logo";
import { PrivateInvitationEntry } from "./PrivateInvitationEntry";
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

// Versioned artwork keeps installed clients from reusing a cached old icon.
const MOBILE_LOGIN_BRAND_IMAGE = "/dealer-social-v6-192.png";

const MobileLoginBrand = () => (
  <span
    className="login-mobile-logo inline-flex shrink-0 items-center gap-3 lg:hidden"
    role="img"
    aria-label="Dealer Social Post AI"
  >
    <img
      src={MOBILE_LOGIN_BRAND_IMAGE}
      alt=""
      width={44}
      height={44}
      className="login-brand-image rounded-[10px]"
    />
    <span
      className="login-wordmark font-display font-semibold text-ink"
      aria-hidden="true"
    >
      Dealer Social
    </span>
  </span>
);

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

/**
 * One line under "Sign in" that says what this mode asks for. The system line
 * is also the copy FrontendProductionPass pins, so the mode's requirement is
 * stated once, at the top of the column, instead of twice.
 */
const MODE_INSTRUCTIONS: Record<EntryMode, string> = {
  personal: "Enter your personal 4-digit code.",
  manager: "Sign in with your manager username and password.",
  system: "Use your system administrator username and password.",
};

/**
 * Segments of a single track, not three separate buttons: the track carries
 * the raised fill and the selected segment carries the brand. Each segment is
 * 44px tall inside the 52px track, so the touch target survives — Sunlight's
 * edge on the track is an inset ring (`.login-switch` in globals.css), not a
 * border, precisely so it takes none of that 44px.
 */
const segmentStyles = (selected: boolean) =>
  cn(
    "rounded-[6px] px-2 text-sm",
    "transition-colors duration-120 ease-out",
    selected
      ? "bg-brand-fill font-semibold text-brand-foreground"
      : "bg-transparent font-medium text-ink-2 hover:text-ink",
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
  const [invitedDealer, setInvitedDealer] = useState<InvitedDealer | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void currentInvitedDealer(controller.signal)
      .then(setInvitedDealer)
      .catch(() => {});
    return () => controller.abort();
  }, []);
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
  const instruction = pendingAttempt
    ? "Complete the security check to continue."
    : entryMode === "personal" && invitedDealer?.name
      ? invitedDealer.name
      : MODE_INSTRUCTIONS[entryMode];

  return (
    // The one moment on this screen (spec §4.4): the mark and the access panel
    // fade up 8px together, once per mount, 320ms. Nothing else animates.
    <m.section
      // Desktop releases the mobile viewport pin (index.html), so percentage
      // heights stop resolving there: the stage claims the viewport minus
      // <main>'s lg:py-6 explicitly, and centres the card inside it.
      className="flex h-full min-h-0 w-full flex-1 flex-col lg:min-h-[calc(100dvh-3rem)] lg:items-center lg:justify-center"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
      aria-label="Dealer access"
    >
      {/* Desktop: one key card centred on the lit stage (<main> carries
          .login-stage). 1040 x 640 minimum, a 432px brand column beside the
          access column, clipped to one 16px radius. Below lg the card's chrome
          drops away entirely and the access column is the whole screen. */}
      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col",
          "lg:grid lg:max-w-260 lg:flex-none lg:grid-cols-[27rem_minmax(0,1fr)]",
          // Never taller than <main>'s scrollport (100dvh minus its lg:py-6).
          // The single implicit row has to be clamped to the card box too
          // (`minmax(0,1fr)`), or it sizes to its content, ignores max-height
          // and the card clips the access column with no way to reach it.
          "lg:grid-rows-[minmax(0,1fr)]",
          "lg:min-h-[min(40rem,calc(100dvh-3rem))] lg:max-h-[calc(100dvh-3rem)]",
          "lg:overflow-hidden lg:rounded-lg lg:border lg:border-hairline lg:bg-panel lg:shadow-dialog",
        )}
      >
        {/* Brand column — desktop only. Login is the one screen with no photo
            and no dealership, so the product's own colour carries it, with the
            mark blown up as a graphic and cropped by the card edge. */}
        <aside className="login-card-brand relative hidden overflow-hidden bg-brand-fill p-10 text-brand-foreground lg:flex lg:flex-col lg:justify-between">
          {/* Theme-independent white/black scrims on the brand fill: the only
              literal colours in this file, and correct under any dealer hue. */}
          <img
            src="/dealer-social-v6-symbol-white.svg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-10 -right-24 w-136 max-w-none opacity-[0.12]"
          />

          <Logo
            tone="onBrand"
            size={40}
            className="relative inline-flex items-center gap-3 self-start"
          />

          <div className="relative max-w-[300px]">
            <p className="font-display text-[36px] font-semibold leading-[40px] tracking-[-0.01em]">
              Dealership photos, ready to post.
            </p>
            <p className="mt-3.5 text-base leading-6 text-brand-foreground opacity-80">
              Create photos, videos, and posts. Review every detail, then choose where
              to share.
            </p>
          </div>
        </aside>

        {/* Access column. One 352px stack on desktop, vertically centred; the
            whole phone screen below lg. Every control in it is exactly that
            width, so nothing steps in or out along the left edge. */}
        <div
          className="login-access-pane flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain px-6 pb-6 pt-6 lg:min-h-0 lg:flex-none lg:items-center lg:justify-center lg:px-14 lg:py-12"
          aria-busy={isLoading}
        >
          {isSuccess || isLoading ? <MobileLoginBrand /> : null}

          {isSuccess ? (
            <div
              className="flex min-h-0 w-full flex-1 flex-col items-center justify-center text-center lg:w-88 lg:flex-none"
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
              className="flex min-h-0 w-full flex-1 flex-col items-center justify-center text-center lg:w-88 lg:flex-none"
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
            <div className="login-form grid min-h-0 w-full flex-1 grid-rows-[auto_auto_minmax(min-content,1fr)] gap-5 lg:w-88 lg:flex-none lg:grid-rows-[auto_auto_auto] lg:gap-6">
              <div
                className={cn(
                  "login-intro flex shrink-0 flex-col gap-1.5",
                  entryMode === "personal" && invitedDealer && !pendingAttempt
                    ? "login-invited-intro"
                    : undefined,
                )}
              >
                <div className="login-brand-row">
                  <MobileLoginBrand />
                  <h1
                    id="login-heading"
                    aria-describedby="login-instruction"
                    className="font-display text-[28px] font-semibold leading-8 tracking-[-0.01em] text-ink lg:text-[32px] lg:leading-9"
                  >
                    Sign in
                  </h1>
                </div>
                <p
                  id="login-instruction"
                  className={cn(
                    "text-[15px] leading-[22px] text-ink-2",
                    entryMode === "personal" && !pendingAttempt && !invitedDealer
                      ? "login-personal-instruction"
                      : "login-mode-instruction",
                  )}
                >
                  {instruction}
                </p>
                {entryMode === "personal" && (
                  <div className="login-invitation-note">
                    {!invitedDealer && (
                      <p className="mt-2 text-sm text-ink-2">
                        New to the team? Open your manager’s private dealership
                        invitation first.
                      </p>
                    )}
                    <PrivateInvitationEntry configured={!!invitedDealer} />
                  </div>
                )}
              </div>

              {/* One segmented track, not three buttons sitting side by side. */}
              <div
                className="login-switch grid h-[52px] shrink-0 grid-cols-3 gap-1 rounded-sm bg-panel-raised p-1"
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
                <div className="login-mode-panel flex min-h-0 flex-col items-start justify-center rounded-md border border-hairline bg-panel-raised p-5">
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
                <div className="login-mode-panel login-personal-panel flex min-h-0 flex-col gap-5 lg:gap-6">
                  <div className="login-code-entry flex shrink-0 flex-col gap-2">
                    <p className="login-code-label text-[13px] font-medium leading-4 text-ink-2">
                      4-digit code
                    </p>

                    {/* Four wells, not four dots: the code reads as a field the
                        keypad fills, and the next well to take a digit carries
                        the brand edge. */}
                    <div
                      className="login-pin-status relative grid grid-cols-4 gap-3"
                      role="status"
                      aria-label={digitsEntered}
                    >
                      {/* Live regions announce text-content changes, not attribute
                          changes — this hidden text gives VoiceOver per-digit feedback
                          while aria-label keeps the region's accessible name stable.
                          `sr-only` is out of flow, so it claims no grid cell. */}
                      <span className="sr-only">{digitsEntered}</span>
                      {Array.from({ length: PERSON_CODE_LENGTH }, (_, index) => (
                        <span
                          key={index}
                          aria-hidden="true"
                          className={cn(
                            "login-code-slot flex h-14 items-center justify-center rounded-sm bg-panel-raised",
                            "border transition-colors duration-120 ease-out",
                            index === dealerCode.length
                              ? "border-[1.5px] border-brand-ink"
                              : "border-hairline",
                          )}
                        >
                          {index < dealerCode.length ? (
                            <span className="h-3 w-3 rounded-full bg-ink" />
                          ) : null}
                        </span>
                      ))}
                    </div>

                    {personalCodeError ? (
                      <p className="text-sm leading-5 text-error-ink" role="alert">
                        {personalCodeError}
                      </p>
                    ) : null}
                  </div>

                  {/* Keys and the one line under them travel together: on a
                      phone the pair sits at the bottom of the screen, in the
                      thumb's reach; on desktop it just follows the field. */}
                  <div className="login-keypad-group mt-auto flex shrink-0 flex-col gap-4 lg:mt-0 lg:gap-6">
                    <div
                      // Four 64px rows at their natural height (spec §4.6 `xl`):
                      // 286px total, so the keypad never stretches to fill a tall
                      // desktop column and never compresses below the touch target.
                      className="login-keypad grid gap-2.5"
                      role="group"
                      aria-label="Four digit access code keypad"
                    >
                      {KEYPAD_ROWS.map((row, rowIndex) => (
                        <div key={rowIndex} className="grid grid-cols-3 gap-2.5">
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
                                className="login-key px-0"
                                aria-label={
                                  key === "backspace"
                                    ? "Delete last digit"
                                    : `Digit ${key}`
                                }
                                onClick={() => void handleKeypadPress(key)}
                              >
                                {key === "backspace" ? (
                                  <Delete
                                    className="h-6 w-6 text-ink-2"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  key
                                )}
                              </Button>
                            ),
                          )}
                        </div>
                      ))}
                    </div>

                    <p className="login-footer-note text-sm leading-5 text-ink-hint">
                      Don&apos;t have a code? Ask your dealership manager.
                    </p>
                  </div>
                </div>
              ) : entryMode === "manager" ? (
                <form
                  className="login-mode-panel flex min-h-0 flex-col justify-start gap-4 overflow-y-auto overscroll-contain"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitManagerLogin();
                  }}
                >
                  {/* The mode's requirement is already stated under "Sign in";
                      this is the section title for the pair of fields. */}
                  <h2 className="shrink-0 text-sm font-semibold text-ink">
                    Dealership manager
                  </h2>

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
                      className="text-sm leading-5 text-error-ink"
                      role="alert"
                    >
                      {managerLoginError}
                    </p>
                  ) : (
                    <p className="text-sm leading-5 text-ink-hint">
                      Contact your system administrator if you need access reset.
                    </p>
                  )}

                  <Button type="submit" variant="primary" size="lg" fullWidth>
                    Continue to manager workspace
                  </Button>
                </form>
              ) : (
                <form
                  className="login-mode-panel flex min-h-0 flex-col justify-start gap-4 overflow-y-auto overscroll-contain"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAdminLogin();
                  }}
                >
                  <h2 className="shrink-0 text-sm font-semibold text-ink">
                    System administrator
                  </h2>

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
                      className="text-sm leading-5 text-error-ink"
                      role="alert"
                    >
                      {adminLoginError}
                    </p>
                  ) : (
                    <p className="text-sm leading-5 text-ink-hint">
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
