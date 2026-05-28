import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import { Logo } from "./Logo";
import { triggerHapticFeedback } from "../utils/haptics";
import { Dialpad } from "./Dialpad";
import { Card, CardContent } from "./ui/Card";
import { useToast } from "./ui/Toast";
import { cn } from "../utils/classNames";

interface LoginScreenProps {
  onLogin: (dealerId: string) => Promise<boolean>;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [dealerCode, setDealerCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const toast = useToast();

  const handleDialpadKeyPress = async (key: string) => {
    triggerHapticFeedback();
    if (isLoading || isSuccess) return;

    let currentCode = dealerCode;
    if (key === "backspace") {
      currentCode = currentCode.slice(0, -1);
    } else if (currentCode.length < 6) {
      currentCode += key;
    }
    setDealerCode(currentCode);

    if (currentCode.length === 6) {
      setIsLoading(true);
      try {
        const loginSuccess = await onLogin(currentCode);
        if (loginSuccess) {
          setIsSuccess(true);
          // Brief success animation before transition
          await new Promise((r) => setTimeout(r, 800));
        } else {
          toast.error("Dealer code not found.");
          setTimeout(() => {
            setDealerCode("");
          }, 1000);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "An unknown error occurred.");
      } finally {
        setIsLoading(false);
      }
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

      if (e.key === "Backspace") {
        handleDialpadKeyPress("backspace");
      } else if (/^[a-zA-Z0-9]$/.test(e.key)) {
        handleDialpadKeyPress(e.key.toUpperCase());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dealerCode, isLoading, isSuccess]);

  return (
    <motion.div
      className="w-full max-w-sm mx-auto flex flex-col items-center justify-center flex-1 p-4 py-6 sm:py-8 relative"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      {/* Ambient glow effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%)",
          }}
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.5, 0.7, 0.5],
          }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>

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
          elevation={4}
          className={cn(
            "min-h-[380px] flex flex-col justify-center",
            "backdrop-blur-xl bg-surface-900/60 border-white/10",
            isSuccess && "border-success-500/50 shadow-glow-success"
          )}
        >
          <CardContent className="flex flex-col justify-center" padded>
            <AnimatePresence mode="wait">
              {isSuccess ? (
                <motion.div
                  key="success"
                  className="flex flex-col items-center justify-center py-12"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.4, type: "spring", stiffness: 300 }}
                >
                  <motion.div
                    className="w-16 h-16 rounded-full bg-success-500/20 flex items-center justify-center mb-4"
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 0.5, repeat: 2 }}
                  >
                    <Sparkles className="h-8 w-8 text-success-400" />
                  </motion.div>
                  <p className="text-lg font-semibold text-success-300">
                    Welcome!
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
                    Authenticating...
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
                    <h1 className="text-2xl font-bold text-surface-50 mb-1">
                      Enter Dealer Code
                    </h1>
                    <p className="text-sm text-surface-400">
                      6-digit access code
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
                          {/* Glow effect for filled dots */}
                          {isFilled && (
                            <motion.div
                              className="absolute inset-0 rounded-full bg-primary-500"
                              initial={{ scale: 0.8, opacity: 0 }}
                              animate={{ scale: 1.8, opacity: 0 }}
                              transition={{ duration: 0.5 }}
                              style={{ filter: "blur(8px)" }}
                            />
                          )}

                          {/* Active indicator ring */}
                          {isActive && (
                            <motion.div
                              className="absolute inset-[-4px] rounded-full border-2 border-primary-400/50"
                              animate={{
                                scale: [1, 1.1, 1],
                                opacity: [0.5, 1, 0.5],
                              }}
                              transition={{ duration: 1.5, repeat: Infinity }}
                            />
                          )}

                          {/* Dot */}
                          <motion.div
                            className={cn(
                              "w-4 h-4 rounded-full transition-all duration-200 relative z-10",
                              isFilled
                                ? "bg-primary-400 shadow-lg shadow-primary-500/50"
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
