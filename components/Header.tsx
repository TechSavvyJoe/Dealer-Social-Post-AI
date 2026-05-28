import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, LogOut, ChevronDown } from "lucide-react";
import { Dealer } from "../types";
import { triggerHapticFeedback } from "../utils/haptics";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { cn } from "../utils/classNames";

interface HeaderProps {
  dealer?: Dealer | null;
  onLogout: () => void;
  onShowSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  dealer,
  onLogout,
  onShowSettings,
}) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [showTooltip, setShowTooltip] = useState<string | null>(null);

  // Track scroll position for enhanced blur effect
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleLogout = () => {
    triggerHapticFeedback();
    onLogout();
  };

  const handleOpenSettings = () => {
    triggerHapticFeedback();
    onShowSettings();
  };

  // Defensive check - should not render if dealer is undefined
  if (!dealer) {
    return null;
  }

  return (
    <motion.header
      className={cn(
        "w-full z-40 sticky top-0",
        "transition-all duration-300 ease-out",
        isScrolled
          ? "bg-surface-900/90 backdrop-blur-2xl shadow-lg shadow-black/10"
          : "bg-surface-900/70 backdrop-blur-xl",
        "border-b",
        isScrolled ? "border-white/10" : "border-white/5"
      )}
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between px-4 py-3 sm:px-6 lg:px-10">
        {/* Dealer Info */}
        <motion.div
          className="flex items-center gap-3"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
        >
          {/* Logo with hover effect */}
          <motion.div
            className="relative group cursor-pointer"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          >
            {dealer.logo ? (
              <>
                {/* Glow effect on hover */}
                <div className="absolute inset-0 rounded-xl bg-primary-500/20 opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-300" />
                <img
                  src={dealer.logo}
                  alt={`${dealer.name} Logo`}
                  className="relative w-10 h-10 object-contain rounded-xl bg-white/10 p-1.5 ring-1 ring-white/10 group-hover:ring-white/20 transition-all"
                />
              </>
            ) : (
              <div
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center",
                  "font-bold text-white text-xl",
                  "shadow-lg ring-1 ring-white/10"
                )}
                style={{
                  background:
                    "linear-gradient(135deg, var(--brand-primary-500), var(--brand-primary))",
                  boxShadow: "0 10px 25px -10px var(--brand-primary, #1d4ed8)",
                }}
              >
                {dealer.name.charAt(0)}
              </div>
            )}
          </motion.div>

          {/* Dealer name with animation */}
          <div className="flex flex-col">
            <span className="font-bold text-surface-50 text-lg tracking-tight leading-tight">
              {dealer.name}
            </span>
            <div className="hidden sm:block mt-0.5">
              <Badge variant="tinted" color="primary" size="sm">
                Social Media Generator
              </Badge>
            </div>
          </div>
        </motion.div>

        {/* Actions */}
        <motion.div
          className="flex items-center gap-2 sm:gap-3"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
        >
          {/* Settings Button with tooltip */}
          <div
            className="relative"
            onMouseEnter={() => setShowTooltip("settings")}
            onMouseLeave={() => setShowTooltip(null)}
          >
            <Button
              variant="tinted"
              size="sm"
              leftIcon={<Settings className="w-4 h-4" />}
              onClick={handleOpenSettings}
              aria-label="Open settings"
              aria-keyshortcuts="Meta+, Control+,"
            >
              <span className="hidden sm:inline">Settings</span>
            </Button>

            {/* Tooltip for mobile */}
            <AnimatePresence>
              {showTooltip === "settings" && (
                <motion.div
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-surface-800 text-xs text-surface-200 rounded-lg whitespace-nowrap sm:hidden z-50"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                >
                  Settings
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Logout Button with enhanced hover */}
          <div
            className="relative"
            onMouseEnter={() => setShowTooltip("logout")}
            onMouseLeave={() => setShowTooltip(null)}
          >
            <Button
              variant="outline"
              size="sm"
              leftIcon={<LogOut className="w-4 h-4" />}
              onClick={handleLogout}
              className={cn(
                "transition-all duration-200",
                "hover:bg-error-500/15 hover:border-error-500/40 hover:text-error-300",
                "active:bg-error-500/25"
              )}
              aria-label="Logout"
              aria-keyshortcuts="Shift+L"
            >
              <span className="hidden sm:inline">Logout</span>
            </Button>

            {/* Tooltip for mobile */}
            <AnimatePresence>
              {showTooltip === "logout" && (
                <motion.div
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-surface-800 text-xs text-surface-200 rounded-lg whitespace-nowrap sm:hidden z-50"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                >
                  Logout
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </motion.header>
  );
};
