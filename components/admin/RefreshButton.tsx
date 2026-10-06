import React from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "../ui/Button";

/** The hub's quiet reload control, in each tab's toolbar. */
export const RefreshButton: React.FC<{ busy: boolean; onClick: () => void }> = ({
  busy,
  onClick,
}) => (
  <Button
    variant="ghost"
    size="icon"
    aria-label="Refresh"
    title="Refresh"
    aria-busy={busy || undefined}
    className="shrink-0"
    onClick={onClick}
  >
    {busy ? (
      <Loader2
        className="h-5 w-5 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
    ) : (
      <RefreshCw className="h-5 w-5" aria-hidden="true" />
    )}
  </Button>
);
