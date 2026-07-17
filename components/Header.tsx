import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, LogOut } from "lucide-react";
import { Dealer } from "../types";
import { triggerHapticFeedback } from "../utils/haptics";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Modal } from "./ui/Modal";
import { cn } from "../utils/classNames";

interface HeaderProps {
  dealer?: Dealer | null;
  onLogout: () => void;
  onShowSettings: () => void;
  /** Guard against discarding a generated result that may not survive reload. */
  confirmBeforeLogout?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  dealer,
  onLogout,
  onShowSettings,
  confirmBeforeLogout = false,
}) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [showTooltip, setShowTooltip] = useState<string | null>(null);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);

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
    if (confirmBeforeLogout) {
      setIsLogoutConfirmOpen(true);
      return;
    }
    onLogout();
  };

  const confirmLogout = () => {
    setIsLogoutConfirmOpen(false);
    onLogout();
  };

  useEffect(() => {
    if (!confirmBeforeLogout) setIsLogoutConfirmOpen(false);
  }, [confirmBeforeLogout]);

  const handleOpenSettings = () => {
    triggerHapticFeedback();
    onShowSettings();
  };

  // Defensive check - should not render if dealer is undefined
  if (!dealer) {
    return null;
  }

  return (
    <>
      <motion.header
        className={cn(
          "w-full z-40 sticky top-0",
          "transition-all duration-300 ease-out",
          isScrolled
            ? "bg-surface-900/90 backdrop-blur-2xl shadow-lg shadow-black/15"
            : "bg-surface-900/70 backdrop-blur-xl",
          "border-b",
          isScrolled ? "border-white/10" : "border-white/5",
        )}
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-3 lg:px-10">
          {/* Dealer Info */}
          <motion.div
            className="flex min-w-0 items-center gap-2 sm:gap-3"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1, duration: 0.4 }}
          >
            {/* Logo with hover effect */}
            <motion.div
              className="relative group shrink-0"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              {dealer.logo ? (
                <img
                  src={dealer.logo}
                  alt={`${dealer.name} logo`}
                  className="relative h-9 w-9 object-contain rounded-xl bg-white/[0.07] p-1 ring-1 ring-white/10 shadow-sm transition-all duration-200 group-hover:ring-white/20 sm:h-11 sm:w-11 sm:rounded-2xl sm:p-1.5"
                />
              ) : (
                <div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl sm:h-11 sm:w-11 sm:rounded-2xl",
                    "font-semibold text-[color:var(--brand-foreground)] text-lg sm:text-xl",
                    "ring-1 ring-white/10 shadow-sm",
                  )}
                  style={{ backgroundColor: "var(--brand-primary)" }}
                  aria-hidden="true"
                >
                  {dealer.name.charAt(0)}
                </div>
              )}
            </motion.div>

            {/* Dealer name + product label, sentence case (Dealer Trust) */}
            <div className="flex min-w-0 flex-col">
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                <span className="truncate text-sm font-semibold tracking-tight leading-tight text-surface-50 sm:text-lg">
                  {dealer.name}
                </span>
                {dealer.requires_approval && (
                  <Badge
                    variant="warning"
                    size="sm"
                    uppercase={false}
                    className="shrink-0"
                  >
                    <span className="sm:hidden">Review</span>
                    <span className="hidden sm:inline">Approval required</span>
                  </Badge>
                )}
              </div>
              <span className="hidden sm:inline text-xs font-medium text-surface-300 mt-0.5 tracking-tight">
                Social post studio
              </span>
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
                aria-keyshortcuts="Meta+K Control+K"
              >
                <span className="hidden sm:inline">Settings</span>
              </Button>

              {/* Tooltip for mobile */}
              <AnimatePresence>
                {showTooltip === "settings" && (
                  <motion.div
                    className="absolute top-full left-1/2 -translate-x-1/2 mt-2 rounded-lg border border-white/10 bg-surface-950/95 px-2 py-1 text-xs text-surface-200 shadow-lg whitespace-nowrap sm:hidden z-50"
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
                  "active:bg-error-500/25",
                )}
                aria-label="Log out"
              >
                <span className="hidden sm:inline">Log out</span>
              </Button>

              {/* Tooltip for mobile */}
              <AnimatePresence>
                {showTooltip === "logout" && (
                  <motion.div
                    className="absolute top-full left-1/2 -translate-x-1/2 mt-2 rounded-lg border border-white/10 bg-surface-950/95 px-2 py-1 text-xs text-surface-200 shadow-lg whitespace-nowrap sm:hidden z-50"
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                  >
                    Log out
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </motion.header>
      <Modal
        isOpen={isLogoutConfirmOpen}
        onClose={() => setIsLogoutConfirmOpen(false)}
        size="sm"
        title="Log out and discard this post?"
        description="This generated result is not fully preserved yet."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setIsLogoutConfirmOpen(false)}
              fullWidth
            >
              Keep working
            </Button>
            <Button variant="danger" onClick={confirmLogout} fullWidth>
              Log out anyway
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-surface-300">
          Save the media and copy the caption first if you want to keep both.
          Logging out clears this workspace.
        </p>
      </Modal>
    </>
  );
};
