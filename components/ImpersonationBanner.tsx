import React, { useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { Button } from "./ui/Button";
import { toUiMessage } from "../utils/errorMessages";

/**
 * Fixed banner while a super-admin is viewing the app as a store person.
 */
export const ImpersonationBanner: React.FC = () => {
  const isImpersonating = useAppStore((s) => s.isImpersonating);
  const person = useAppStore((s) => s.currentPerson);
  const dealer = useAppStore((s) => s.currentDealer);
  const exitImpersonation = useAppStore((s) => s.exitImpersonation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isImpersonating) return null;

  const roleLabel = person?.role === "manager" ? "manager" : "salesperson";

  const handleExit = async () => {
    setBusy(true);
    setError(null);
    try {
      await exitImpersonation();
    } catch (err) {
      setError(toUiMessage(err, "Could not exit impersonation."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="sticky top-0 z-50 border-b border-violet-400/30 bg-violet-950/95 text-violet-50 shadow-lg backdrop-blur-md"
      role="status"
    >
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <UserRound className="h-4 w-4 shrink-0 text-violet-300" />
          <span>
            <strong className="font-semibold">Impersonating</strong>
            {person?.name ? (
              <>
                {" "}
                <span className="text-violet-100">{person.name}</span>
              </>
            ) : null}
            <span className="text-violet-300">
              {" "}
              ({roleLabel}
              {dealer?.name ? ` · ${dealer.name}` : ""})
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {error ? <span className="text-xs text-rose-200">{error}</span> : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            leftIcon={<LogOut className="h-3.5 w-3.5" />}
            onClick={() => void handleExit()}
            className="border-violet-300/40 bg-white text-violet-950 hover:bg-violet-50"
          >
            {busy ? "Exiting…" : "Exit to System Admin"}
          </Button>
        </div>
      </div>
    </div>
  );
};
