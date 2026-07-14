import React, { useCallback, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Logo } from "./Logo";
import { triggerHapticFeedback } from "../utils/haptics";
import { Dialpad } from "./Dialpad";
import { Card, CardContent } from "./ui/Card";
import { useToast } from "./ui/Toast";
import { cn } from "../utils/classNames";

const DEALER_CODE_LENGTH = 6;
const ADMIN_CODE_MAX_LENGTH = 12;

interface LoginScreenProps {
  onLogin: (dealerId: string) => Promise<boolean>;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [dealerCode, setDealerCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const toast = useToast();
  const isAdminCodeEntry = /[A-Z]/i.test(dealerCode) || dealerCode.length > DEALER_CODE_LENGTH;

  const submitCode = useCallback(
    async (codeToSubmit: string) => {
      const normalizedCode = codeToSubmit.trim().toUpperCase();
      if (
        isLoading ||
        isSuccess ||
        normalizedCode.length < DEALER_CODE_LENGTH
      ) {
        if (normalizedCode.length > 0 && normalizedCode.length < DEALER_CODE_LENGTH) {
          toast.info("Enter at least 6 characters to sign in.");
        }
        return;
      }

      setIsLoading(true);
      try {
        const loginSuccess = await onLogin(normalizedCode);
        if (loginSuccess) {
          setIsSuccess(true);
          toast.success("Access confirmed.");
          // Brief success animation before transition
          await new Promise((r) => setTimeout(r, 800));
        } else {
          toast.error("Code not recognized. Check the code and try again.");
          if (/^\d{6}$/.test(normalizedCode)) {
            setDealerCode("");
          } else {
            setDealerCode(normalizedCode);
          }
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "An unknown error occurred.");
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, isSuccess, onLogin, toast]
  );

  const handleDialpadKeyPress = async (key: string) => {
    triggerHapticFeedback();
    if (isLoading || isSuccess) return;

    if (key === "clear") {
      setDealerCode("");
      return;
    }

    const currentCode =
      key === "backspace"
        ? dealerCode.slice(0, -1)
        : /^\d$/.test(key) && dealerCode.length < DEALER_CODE_LENGTH
        ? `${dealerCode}${key}`
        : dealerCode;

    setDealerCode(currentCode);

    if (currentCode.length === DEALER_CODE_LENGTH && /^\d{6}$/.test(currentCode)) {
      await submitCode(currentCode);
    }
  };

  // Allow physical keyboard for alphanumeric admin codes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        isLoading ||
        isSuccess
      ) {
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        submitCode(dealerCode);
      } else if (e.key === "Backspace") {
        handleDialpadKeyPress("backspace");
      } else if (e.key === "Escape") {
        setDealerCode("");
      } else if (/^[a-zA-Z0-9]$/.test(e.key)) {
        const nextCode = `${dealerCode}${e.key.toUpperCase()}`.slice(
          0,
          ADMIN_CODE_MAX_LENGTH
        );
        setDealerCode(nextCode);
        if (nextCode.length === DEALER_CODE_LENGTH && /^\d{6}$/.test(nextCode)) {
          submitCode(nextCode);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dealerCode, handleDialpadKeyPress, isLoading, isSuccess, submitCode]);

  return (
    <motion.div
      className="w-full max-w-sm mx-auto flex flex-col items-center justify-center flex-1 p-4 py-6 sm:py-8 relative"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      {/* Brand-tinted ambient glow — static, subtle, picks up dealer color. */}
      <div
        aria-hidden="true"
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[420px] h-[420px] rounded-full pointer-events-none opacity-50"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--brand-primary) 14%, transparent), transparent 70%)",
        }}
      />

      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10"
      >
        <Logo className="w-full max-w-[280px] h-auto mx-auto mb-6 sm:mb-8" />
      </motion.div>

      {/* Login Card */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full relative z-10"
      >
        <Card
          elevation={3}
          className={cn(
            "min-h-[420px] flex flex-col justify-center",
            "backdrop-blur-xl border-white/[0.08]",
            isSuccess && "border-success-500/50 shadow-glow-success"
          )}
          style={{
            backgroundColor:
              "color-mix(in srgb, rgb(var(--color-surface-elevated)) 82%, transparent)",
          }}
          aria-live="polite"
          aria-busy={isLoading}
        >
          <CardContent className="flex flex-col justify-center" padded>
            <AnimatePresence mode="wait">
              {isSuccess ? (
                <motion.div
                  key="success"
                  className="flex flex-col items-center justify-center py-12 text-center"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.4, type: "spring", stiffness: 300 }}
                >
                  <motion.div
                    className="w-16 h-16 rounded-full bg-success-500/15 border border-success-500/30 flex items-center justify-center mb-4"
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 0.5, repeat: 2 }}
                  >
                    <CheckCircle2 className="h-8 w-8 text-success-400" />
                  </motion.div>
                  <p className="text-lg font-semibold text-success-300">
                    Access confirmed
                  </p>
                  <p className="mt-1 text-sm text-surface-400">
                    Opening your dealership workspace.
                  </p>
                </motion.div>
              ) : isLoading ? (
                <motion.div
                  key="loading"
                  className="flex flex-col items-center justify-center py-12"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="relative">
                    <Loader2 className="h-12 w-12 text-primary-400 animate-spin" />
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 border-primary-400/30"
                      animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  </div>
                  <p className="mt-4 text-sm text-surface-300">
                    Verifying access...
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="login-form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-6"
                >
                  {/* Title */}
                  <motion.div
                    className="text-center"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                  >
                    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
                      <ShieldCheck className="h-5 w-5 text-primary-300" />
                    </div>
                    <h1 className="text-2xl font-bold text-surface-50 mb-1">
                      Enter dealer code
                    </h1>
                    <p className="text-sm text-surface-400">
                      Use the keypad for six digits, or type an admin code and press Enter.
                    </p>
                  </motion.div>

                  {/* PIN Dots with enhanced glow */}
                  <div className="flex justify-center gap-3 sm:gap-5 py-6">
                    {[...Array(6)].map((_, i) => {
                      const isFilled = i < dealerCode.length;
                      const isActive = i === dealerCode.length;

                      return (
                        <motion.div
                          key={i}
                          className="relative"
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{
                            delay: 0.3 + i * 0.08,
                            type: "spring",
                            stiffness: 400,
                            damping: 20,
                          }}
                        >
                          {/* Active indicator ring — a calm static ring marks
                              the next slot without a perpetual pulse. */}
                          {isActive && (
                            <div className="absolute inset-[-4px] rounded-full border-2 border-primary-400/40" />
                          )}

                          {/* Dot */}
                          <motion.div
                            className={cn(
                              "w-4 h-4 rounded-full transition-all duration-200 relative z-10",
                              isFilled
                                ? "bg-primary-400 shadow-lg shadow-primary-500/30"
                                : "bg-surface-700/80 border border-surface-600"
                            )}
                            animate={{
                              scale: isFilled ? 1.25 : 1,
                            }}
                            transition={{
                              type: "spring",
                              stiffness: 500,
                              damping: 15,
                            }}
                          />
                        </motion.div>
                      );
                    })}
                  </div>

                  <div
                    className={cn(
                      "min-h-[34px] rounded-full border px-3 py-2 text-center text-xs font-medium transition-all",
                      isAdminCodeEntry
                        ? "border-primary-500/30 bg-primary-500/10 text-primary-200"
                        : "border-white/[0.06] bg-white/[0.03] text-surface-400"
                    )}
                    aria-live="polite"
                  >
                    {isAdminCodeEntry
                      ? `${dealerCode.length}/${ADMIN_CODE_MAX_LENGTH} admin code characters. Press Enter to continue.`
                      : dealerCode.length > 0
                      ? `${DEALER_CODE_LENGTH - dealerCode.length} digits remaining`
                      : "Ready for salesperson access"}
                  </div>

                  {/* Dialpad */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                  >
                    <Dialpad onKeyPress={handleDialpadKeyPress} />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
};
