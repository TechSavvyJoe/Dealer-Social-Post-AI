import React, { useState, useEffect } from "react";
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
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);

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
      <header
        className={cn(
          "w-full z-40 sticky top-0 h-14",
          studioMode && "max-sm:hidden",
          "bg-panel border-b border-hairline",
        )}
      >
        <div className="mx-auto flex h-full w-full max-w-screen-2xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
          {/* Product/dealer identity */}
          <div className="flex min-w-0 items-center gap-3">
            {studioMode ? (
              <>
                <Logo markOnly size={36} className="sm:hidden" />
                <Logo className="hidden sm:flex" />
                <span
                  className="hidden h-7 w-px shrink-0 bg-hairline md:block"
                  aria-hidden="true"
                />
                <div className="hidden min-w-0 md:block">
                  <h1 className="truncate text-sm font-semibold tracking-tight text-ink">
                    Publish studio
                  </h1>
                  <p className="truncate text-2xs text-ink-2">{dealer.name}</p>
                </div>
              </>
            ) : (
              <>
                {dealer.logo ? (
                  <img
                    src={dealer.logo}
                    alt={`${dealer.name} logo`}
                    className="h-10 w-10 shrink-0 rounded-md object-contain bg-panel-raised p-1.5 border border-hairline"
                  />
                ) : (
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
                      "bg-brand-fill text-brand-foreground font-semibold text-xl",
                    )}
                    aria-hidden="true"
                  >
                    {dealer.name.charAt(0)}
                  </div>
                )}

                <div className="flex min-w-0 flex-col">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-base font-semibold tracking-tight leading-tight text-ink">
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
                  {person && (
                    <span className="mt-0.5 hidden truncate text-caption text-ink-2 md:inline">
                      Posting as {person.name}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            {studioMode && person ? (
              <div
                className="hidden min-h-10 items-center gap-2.5 rounded-sm border border-hairline bg-panel-raised px-2.5 sm:flex"
                aria-label={`Posting as ${person.name}`}
              >
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-fill text-2xs font-bold text-brand-foreground"
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
                  <span className="block text-2xs text-ink-2">Posting as</span>
                  <span className="block max-w-32 truncate text-caption font-semibold text-ink">
                    {person.name}
                  </span>
                </span>
              </div>
            ) : null}
            {onShowHistory && (
              <div className={cn("relative", studioMode && "lg:hidden")}>
                <Button
                  variant="ghost"
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
                variant="ghost"
                size="sm"
                leftIcon={<Settings className="w-4 h-4" />}
                onClick={handleOpenSettings}
                aria-label="Open settings"
                aria-keyshortcuts="Meta+K Control+K"
              >
                <span className="hidden sm:inline">Settings</span>
              </Button>
            </div>

            {/* Logout Button */}
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<LogOut className="w-4 h-4" />}
                onClick={handleLogout}
                className="hover:text-error-ink hover:bg-error-fill"
                aria-label="Log out"
              >
                <span className="hidden sm:inline">Log out</span>
              </Button>
            </div>
          </div>
        </div>
      </header>
      <Modal
        isOpen={isLogoutConfirmOpen}
        onClose={() => setIsLogoutConfirmOpen(false)}
        size="sm"
        title="Log out and discard this post?"
        description="This post hasn't been saved yet."
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
        <p className="text-sm leading-relaxed text-ink-2">
          Save the image and copy the caption first if you want to keep them.
        </p>
      </Modal>
    </>
  );
};
