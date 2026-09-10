import React, { useState, useEffect } from "react";
import { m } from "framer-motion";
import { History, Settings, LogOut } from "lucide-react";
import { Dealer } from "../types";
import { triggerHapticFeedback } from "../utils/haptics";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Modal } from "./ui/Modal";
import { cn } from "../utils/classNames";
import { Logo } from "./Logo";
import type { PersonSummary } from "../services/salespeople";

interface HeaderProps {
  dealer?: Dealer | null;
  person?: PersonSummary | null;
  onLogout: () => void;
  onShowSettings: () => void;
  onShowHistory?: () => void;
  /** Guard against discarding a generated result that may not survive reload. */
  confirmBeforeLogout?: boolean;
  /** Dense product/context chrome for the result publishing workspace. */
  studioMode?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  dealer,
  person,
  onLogout,
  onShowSettings,
  onShowHistory,
  confirmBeforeLogout = false,
  studioMode = false,
}) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);

  // Track scroll position for the blur/shadow treatment. On mobile the body
  // is viewport-pinned and scrolling happens inside #main-content, so bind to
  // the real scrollport with window as the desktop document-flow fallback.
  useEffect(() => {
    const scrollport = document.getElementById("main-content");
    const readOffset = () => (scrollport ? scrollport.scrollTop : window.scrollY);
    const handleScroll = () => {
      setIsScrolled(readOffset() > 10);
    };
    const target: HTMLElement | Window = scrollport ?? window;
    target.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", handleScroll);
      window.removeEventListener("scroll", handleScroll);
    };
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

  const handleOpenHistory = () => {
    triggerHapticFeedback();
    onShowHistory?.();
  };

  // Defensive check - should not render if dealer is undefined
  if (!dealer) {
    return null;
  }

  return (
    <>
      <m.header
        className={cn(
          "w-full z-40 sticky top-0",
          studioMode && "max-sm:hidden",
          "transition-all duration-300 ease-out",
          isScrolled
            ? "bg-surface-900/90 backdrop-blur-2xl shadow-lg shadow-black/15"
            : "bg-surface-900/70 backdrop-blur-xl",
          "border-b",
          isScrolled ? "border-hairline" : "border-hairline",
        )}
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6 sm:py-3 lg:px-10">
          {/* Product/dealer identity */}
          <m.div
            className="flex min-w-0 items-center gap-3"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1, duration: 0.4 }}
          >
            {studioMode ? (
              <>
                <img
                  src="/dsp-brand-mark-v3.svg"
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-xl sm:hidden"
                  aria-hidden="true"
                />
                <Logo className="hidden h-9 w-[13.5rem] shrink-0 sm:block" />
                <span
                  className="hidden h-7 w-px shrink-0 bg-fill-hover md:block"
                  aria-hidden="true"
                />
                <div className="hidden min-w-0 md:block">
                  <h1 className="truncate text-sm font-semibold tracking-tight text-surface-50">
                    Publish studio
                  </h1>
                  <p className="truncate text-[11px] text-surface-400">{dealer.name}</p>
                </div>
              </>
            ) : (
              <>
                <m.div
                  className="relative group shrink-0"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                >
                  {dealer.logo ? (
                    <img
                      src={dealer.logo}
                      alt={`${dealer.name} logo`}
                      className="relative h-10 w-10 object-contain rounded-2xl bg-fill-hover p-1.5 ring-1 ring-hairline shadow-sm transition-all duration-200 group-hover:ring-strong sm:h-11 sm:w-11"
                    />
                  ) : (
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-2xl sm:h-11 sm:w-11",
                        "font-semibold text-[color:var(--brand-foreground)] text-xl",
                        "ring-1 ring-hairline shadow-sm",
                      )}
                      style={{ backgroundColor: "var(--brand-primary)" }}
                      aria-hidden="true"
                    >
                      {dealer.name.charAt(0)}
                    </div>
                  )}
                </m.div>

                <div className="flex min-w-0 flex-col">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-base font-semibold tracking-tight leading-tight text-surface-50 sm:text-lg">
                      {dealer.name}
                    </span>
                    {dealer.requires_approval && (
                      <Badge
                        variant="warning"
                        size="sm"
                        uppercase={false}
                        className="shrink-0"
                      >
                        <span className="max-sm:hidden">Approval required</span>
                        <span className="sm:hidden">Review</span>
                      </Badge>
                    )}
                  </div>
                  <span className="mt-0.5 hidden text-xs font-medium tracking-tight text-surface-300 sm:inline">
                    Social post studio
                  </span>
                </div>
              </>
            )}
          </m.div>

          {/* Actions */}
          <m.div
            className="flex items-center gap-2 sm:gap-3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            {studioMode && person ? (
              <div
                className="hidden min-h-10 items-center gap-2.5 rounded-xl border border-hairline bg-fill-subtle px-2.5 sm:flex"
                aria-label={`Posting as ${person.name}`}
              >
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary-500/20 text-[10px] font-bold text-primary-100 ring-1 ring-primary-300/25 [.theme-light_&]:text-primary-950"
                  aria-hidden="true"
                >
                  {person.name
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase())
                    .join("") || "U"}
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block text-[10px] text-surface-400">Posting as</span>
                  <span className="block max-w-32 truncate text-xs font-semibold text-surface-100">
                    {person.name}
                  </span>
                </span>
              </div>
            ) : null}
            {onShowHistory && (
              <div className={cn("relative", studioMode && "lg:hidden")}>
                <Button
                  variant="tinted"
                  size="sm"
                  leftIcon={<History className="h-4 w-4" />}
                  onClick={handleOpenHistory}
                  aria-label="Open my work"
                >
                  <span className="hidden sm:inline">My work</span>
                </Button>
              </div>
            )}

            {/* Settings Button */}
            <div className={cn("relative", studioMode && "lg:hidden")}>
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
            </div>

            {/* Logout Button with enhanced hover */}
            <div className="relative">
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
            </div>
          </m.div>
        </div>
      </m.header>
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
          Save the media and copy the caption first if you want to keep both. Logging
          out clears this workspace.
        </p>
      </Modal>
    </>
  );
};
