import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  KeyRound,
  Loader2,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";
import { Logo } from "./Logo";
import { triggerHapticFeedback } from "../utils/haptics";
import { Dialpad, type DialpadKey } from "./Dialpad";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { cn } from "../utils/classNames";

/** Personal manager / user access codes are exactly 4 digits. */
const PERSON_CODE_LENGTH = 4;
/** Super-admin env secret may be longer alphanumeric. */
const ADMIN_CODE_MAX_LENGTH = 12;
const ADMIN_CODE_MIN_LENGTH = 4;

interface LoginScreenProps {
  onLogin: (dealerId: string) => Promise<boolean>;
}

type EntryMode = "personal" | "system";

const STUDIO_STEPS = [
  { label: "Capture", detail: "Start with the vehicle", icon: Camera },
  { label: "Shape", detail: "Build the right story", icon: WandSparkles },
  { label: "Share", detail: "Publish with confidence", icon: ArrowRight },
] as const;

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [entryMode, setEntryMode] = useState<EntryMode>("personal");
  const [dealerCode, setDealerCode] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const adminInputRef = useRef<HTMLInputElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const toast = useToast();

  const submitCode = useCallback(
    async (codeToSubmit: string, mode: EntryMode) => {
      const normalizedCode =
        mode === "personal"
          ? codeToSubmit.trim()
          : codeToSubmit.trim().toUpperCase();
      const minLen =
        mode === "personal" ? PERSON_CODE_LENGTH : ADMIN_CODE_MIN_LENGTH;
      if (isLoading || isSuccess || normalizedCode.length < minLen) {
        if (normalizedCode.length > 0 && normalizedCode.length < minLen) {
          toast.info(
            mode === "personal"
              ? "Enter your 4-digit access code."
              : "Enter your system admin code.",
          );
        }
        return;
      }

      setIsLoading(true);
      try {
        const loginSuccess = await onLogin(normalizedCode);
        if (loginSuccess) {
          setIsSuccess(true);
          toast.success("Access confirmed.");
          await new Promise((resolve) =>
            setTimeout(resolve, shouldReduceMotion ? 150 : 650),
          );
        } else {
          toast.error("Code not recognized. Check the code and try again.");
          if (mode === "personal") {
            setDealerCode("");
          } else {
            setAdminCode(normalizedCode);
          }
        }
      } catch {
        toast.error(
          "We could not verify this code. Check your connection and try again.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, isSuccess, onLogin, shouldReduceMotion, toast],
  );

  const handleDialpadKeyPress = useCallback(
    async (key: DialpadKey) => {
      triggerHapticFeedback();
      if (isLoading || isSuccess) return;

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
        await submitCode(nextCode, "personal");
      }
    },
    [dealerCode, isLoading, isSuccess, submitCode],
  );

  const selectMode = useCallback((mode: EntryMode) => {
    triggerHapticFeedback();
    setEntryMode(mode);
  }, []);

  useEffect(() => {
    if (entryMode !== "system" || isLoading || isSuccess) return;
    const frame = requestAnimationFrame(() => adminInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [entryMode, isLoading, isSuccess]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        isLoading ||
        isSuccess
      ) {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const activeCode = entryMode === "system" ? adminCode : dealerCode;
        void submitCode(activeCode, entryMode);
      } else if (event.key === "Backspace" && entryMode === "personal") {
        event.preventDefault();
        void handleDialpadKeyPress("backspace");
      } else if (event.key === "Escape") {
        event.preventDefault();
        entryMode === "system" ? setAdminCode("") : setDealerCode("");
      } else if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        setEntryMode("system");
        setAdminCode((current) =>
          `${current}${event.key.toUpperCase()}`.slice(
            0,
            ADMIN_CODE_MAX_LENGTH,
          ),
        );
      } else if (/^\d$/.test(event.key)) {
        event.preventDefault();
        if (entryMode === "system") {
          setAdminCode((current) =>
            `${current}${event.key}`.slice(0, ADMIN_CODE_MAX_LENGTH),
          );
        } else {
          void handleDialpadKeyPress(event.key as DialpadKey);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    adminCode,
    dealerCode,
    entryMode,
    handleDialpadKeyPress,
    isLoading,
    isSuccess,
    submitCode,
  ]);

  const motionTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <motion.section
      className="relative mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col"
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTransition}
      aria-label="Dealer access"
    >
      <div
        className={cn(
          "relative grid h-full min-h-0 w-full flex-1 border border-white/[0.09] bg-[#0b1017] shadow-[0_24px_80px_rgba(0,0,0,0.38)]",
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

        <aside className="relative hidden min-h-[38rem] overflow-hidden border-r border-white/[0.07] bg-[#111824] p-10 lg:flex lg:flex-col">
          <Logo className="relative z-10 h-auto w-[250px]" />

          <div
            className="absolute right-10 top-24 h-64 w-52 border border-white/[0.08]"
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
              A focused workspace for dealership teams to create polished posts
              while the delivery moment is still fresh.
            </p>

            <ol className="mt-8 grid grid-cols-3 gap-3 border-t border-white/[0.08] pt-5">
              {STUDIO_STEPS.map(({ label, detail, icon: StepIcon }, index) => (
                <li key={label} className="min-w-0">
                  <div className="mb-2 flex items-center gap-2 text-primary-300">
                    <StepIcon className="h-4 w-4" aria-hidden="true" />
                    <span className="font-mono text-[10px] tabular-nums">
                      0{index + 1}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-surface-100">
                    {label}
                  </p>
                  <p className="mt-0.5 text-xs leading-snug text-surface-500">
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
            "grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)]",
            "px-5 pt-4 pb-3 sm:px-8 sm:pt-7 sm:pb-6 lg:min-h-[38rem] lg:px-10 lg:py-8",
          )}
          aria-live="polite"
          aria-busy={isLoading}
        >
          <Logo className="mb-3 h-auto w-[min(188px,50vw)] shrink-0 justify-self-start lg:hidden" />

          <AnimatePresence mode="wait">
            {isSuccess ? (
              <motion.div
                key="success"
                className="flex min-h-0 flex-col items-center justify-center text-center"
                initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={motionTransition}
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
              </motion.div>
            ) : isLoading ? (
              <motion.div
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
              </motion.div>
            ) : (
              <motion.div
                key="login-form"
                className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 sm:gap-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={motionTransition}
              >
                <div className="flex shrink-0 items-start gap-3">
                  <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
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
                      Tap your 4-digit code. We sign you in automatically.
                    </p>
                  </div>
                </div>

                <div
                  className="grid shrink-0 grid-cols-2 gap-1 rounded-2xl border border-white/[0.08] bg-black/25 p-1.5"
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
                    onClick={() => selectMode("system")}
                    aria-pressed={entryMode === "system"}
                    className={cn(
                      "min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors sm:min-h-12",
                      entryMode === "system"
                        ? "bg-primary-600 text-white shadow-md"
                        : "text-surface-300 hover:text-surface-100",
                    )}
                  >
                    System admin
                  </button>
                </div>

                {entryMode === "personal" ? (
                  <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-2 sm:gap-3">
                    <div
                      className="flex shrink-0 items-center justify-center gap-4 py-1"
                      role="status"
                      aria-label={`${dealerCode.length} of ${PERSON_CODE_LENGTH} digits entered`}
                    >
                      {Array.from(
                        { length: PERSON_CODE_LENGTH },
                        (_, index) => (
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
                        ),
                      )}
                    </div>

                    <p
                      className="shrink-0 text-center text-sm text-surface-400"
                      aria-live="polite"
                    >
                      {dealerCode.length > 0
                        ? `${PERSON_CODE_LENGTH - dealerCode.length} left`
                        : "4 digits · from your manager"}
                    </p>

                    <div className="min-h-0 w-full">
                      <Dialpad onKeyPress={handleDialpadKeyPress} />
                    </div>
                  </div>
                ) : (
                  <form
                    className="flex min-h-0 flex-col justify-center overflow-y-auto overscroll-contain"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitCode(adminCode, "system");
                    }}
                  >
                    <div className="rounded-2xl border border-white/[0.08] bg-[#101722] p-4 sm:p-5">
                      <div className="mb-4 flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-300">
                          <KeyRound className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <div>
                          <h2 className="text-base font-semibold text-surface-100">
                            System administrator
                          </h2>
                          <p className="mt-1 text-sm leading-relaxed text-surface-400">
                            Platform owner code from your deployment secret.
                          </p>
                        </div>
                      </div>

                      <Input
                        ref={adminInputRef}
                        label="System admin code"
                        value={adminCode}
                        onChange={(event) =>
                          setAdminCode(
                            event.target.value
                              .replace(/[^a-zA-Z0-9]/g, "")
                              .toUpperCase()
                              .slice(0, ADMIN_CODE_MAX_LENGTH),
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setAdminCode("");
                        }}
                        leftIcon={<KeyRound />}
                        autoComplete="off"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        inputMode="text"
                        enterKeyHint="go"
                        maxLength={ADMIN_CODE_MAX_LENGTH}
                        helperText={`${adminCode.length}/${ADMIN_CODE_MAX_LENGTH} characters`}
                        fullWidth
                      />

                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        fullWidth
                        disabled={adminCode.length < ADMIN_CODE_MIN_LENGTH}
                        className="mt-4 min-h-12 sm:min-h-14"
                        rightIcon={<ArrowRight className="h-4 w-4" />}
                      >
                        Continue to system admin
                      </Button>
                    </div>
                  </form>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.section>
  );
};
