import React, { useState, useEffect } from "react";
import { History, Settings, LogOut, ChevronLeft } from "lucide-react";
import { Dealer } from "../types";
import { triggerHapticFeedback } from "../utils/haptics";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Modal } from "./ui/Modal";
import { cn } from "../utils/classNames";
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
  onBack?: () => void;
  /**
   * The step's name ("Delivery", "My work"). On phones with a Back button it
   * replaces the store identity as the header's title.
   */
  flowTitle?: string;
  navigationDisabled?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  dealer,
  person,
  onLogout,
  onShowSettings,
  onShowHistory,
  confirmBeforeLogout = false,
  studioMode = false,
  onBack,
  flowTitle,
  navigationDisabled = false,
}) => {
  const [accountOpen, setAccountOpen] = useState(false);
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

  // Phones on a flow screen show chevron, step title and avatar only: the
  // store tile and name step aside so the brand colour stays on the primary
  // action, not the chrome (spec §5.5, Details and Post artboards).
  const flowHeading = Boolean(onBack && flowTitle);
  const initials = (person?.name || dealer.name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return (
    <>
      <header
        className={cn(
          "w-full z-40 relative h-14 shrink-0 md:h-16",

          "bg-panel border-b border-hairline",
        )}
      >
        <div className="mx-auto flex h-full w-full max-w-screen-2xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
          {/* Product/dealer identity */}
          <div className="flex min-w-0 items-center gap-3">
            {onBack && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack}
                aria-label="Go back"
                disabled={navigationDisabled}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            )}

            {dealer.logo ? (
              <img
                src={dealer.logo}
                alt={`${dealer.name} logo`}
                className={cn(
                  "h-10 w-10 shrink-0 rounded-md object-contain bg-panel-raised p-1.5 border border-hairline",
                  flowHeading && "max-md:hidden",
                )}
              />
            ) : (
              <img
                src="/dealer-social-dsp-v5-192.png"
                alt="Dealer Social"
                className={cn(
                  "h-10 w-10 shrink-0 rounded-md border border-hairline",
                  flowHeading && "max-md:hidden",
                )}
              />
            )}

            <div className="flex min-w-0 flex-col">
              <div className="flex min-w-0 items-center gap-2">
                {flowHeading && (
                  <span className="truncate font-display text-[17px] font-semibold leading-tight text-ink md:hidden">
                    {flowTitle}
                  </span>
                )}
                <span
                  className={cn(
                    "truncate text-base font-semibold leading-tight text-ink",
                    flowHeading && "max-md:hidden",
                  )}
                >
                  Dealer Social
                </span>
                {/* On a phone flow screen the step title needs the room: at
                    320 px the badge would truncate "New arrival". Home and
                    wider screens still carry it. */}
                {dealer.requires_approval && (
                  <Badge
                    variant="warning"
                    size="sm"
                    uppercase={false}
                    className={cn("shrink-0", flowHeading && "max-sm:hidden")}
                  >
                    <span className="max-sm:hidden">Approval required</span>
                    <span className="sm:hidden">Approval on</span>
                  </Badge>
                )}
              </div>
              <span
                className={cn(
                  "mt-1 truncate text-xs text-ink-2",
                  flowHeading && "max-md:hidden",
                )}
              >
                {dealer.name}
              </span>
              {person && (
                <span className="mt-0.5 hidden truncate text-caption text-ink-2 md:inline">
                  Posting as {person.name}
                </span>
              )}
              {flowTitle && !flowHeading && (
                <span className="mt-0.5 text-caption text-ink-2 md:hidden">
                  {flowTitle}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <nav
            aria-label="Account"
            className="hidden items-center gap-2 sm:flex sm:gap-3"
          >
            {studioMode && person ? (
              <div
                className="hidden min-h-10 items-center gap-2.5 rounded-sm border border-hairline bg-panel-raised px-2.5 sm:flex"
                aria-label={`Posting as ${person.name}`}
              >
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-fill text-xs font-bold text-brand-foreground"
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
                  <span className="block text-xs text-ink-2">Posting as</span>
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
                  className="min-h-11"
                  disabled={navigationDisabled}
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
                className="min-h-11"
                disabled={navigationDisabled}
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
                disabled={navigationDisabled}
                onClick={handleLogout}
                className="min-h-11 hover:text-error-ink hover:bg-error-fill"
                aria-label="Log out"
              >
                <span className="hidden sm:inline">Log out</span>
              </Button>
            </div>
          </nav>
          {/* A 44 px target drawing a 36 px disc, so it never outweighs the
              dealer tile on Home or the primary action on a flow screen. */}
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-full p-0 sm:hidden"
            aria-label="Open account menu"
            aria-expanded={accountOpen}
            aria-controls="account-menu"
            onClick={() => setAccountOpen(!accountOpen)}
            disabled={navigationDisabled}
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-fill text-sm font-semibold text-brand-foreground">
              {initials}
            </span>
          </Button>
          {accountOpen && (
            <>
              <button
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Close account menu"
                onClick={() => setAccountOpen(false)}
              />
              <nav
                id="account-menu"
                aria-label="Account menu"
                className="absolute right-4 top-full z-50 w-60 rounded-md border border-strong bg-overlay p-2 shadow-dialog on-overlay"
              >
                {person && (
                  <p className="border-b border-hairline px-3 py-3 text-sm text-ink-2">
                    Posting as {person.name}
                  </p>
                )}
                {onShowHistory && (
                  <Button
                    variant="ghost"
                    fullWidth
                    className="justify-start"
                    onClick={() => {
                      setAccountOpen(false);
                      handleOpenHistory();
                    }}
                  >
                    My work
                  </Button>
                )}
                <Button
                  variant="ghost"
                  fullWidth
                  className="justify-start"
                  onClick={() => {
                    setAccountOpen(false);
                    handleOpenSettings();
                  }}
                >
                  Settings
                </Button>
                <Button
                  variant="ghost"
                  fullWidth
                  className="justify-start"
                  onClick={() => {
                    setAccountOpen(false);
                    handleLogout();
                  }}
                >
                  Log out
                </Button>
              </nav>
            </>
          )}
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
              variant="secondary"
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
