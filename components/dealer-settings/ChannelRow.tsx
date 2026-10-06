import React, { useId } from "react";
import { ChevronUp } from "lucide-react";
import { Button } from "../ui/Button";
import { cn } from "../../utils/classNames";
import { DoneMark } from "./SettingsRows";

export type ChannelRowStatus = "ready" | "missing" | "optional";

interface ChannelRowProps {
  title: string;
  /**
   * The line under the name while the row is closed: the saved value,
   * "Missing. {what it costs}" or the optional row's sentence. Status is read
   * from the SAVED record.
   */
  summary: React.ReactNode;
  status: ChannelRowStatus;
  /** Defaults to "Edit" for a ready row and "Add" otherwise. */
  action?: "Add" | "Edit";
  open: boolean;
  onToggle: () => void;
  /** The fields and the "where to find" steps. */
  children: React.ReactNode;
}

/**
 * One collapsible channel. Closed: name, saved value or status, and "Edit" or
 * "Add". Open: the name and its status mark only (the fields below hold the
 * value), the fields and steps, and a chevron to close it. The toggle is one
 * button throughout, named with the channel ("Edit Instagram"), with
 * aria-expanded and aria-controls.
 *
 * The panel's display follows `open` through its class as well as the
 * `hidden` attribute: a display utility such as `flex` outranks Tailwind's
 * `[hidden]` preflight rule, so the attribute alone would leave it on screen.
 */
export const ChannelRow: React.FC<ChannelRowProps> = ({
  title,
  summary,
  status,
  action = status === "ready" ? "Edit" : "Add",
  open,
  onToggle,
  children,
}) => {
  const panelId = useId();
  return (
    <div className="border-b border-hairline">
      <div className="flex min-h-[4.25rem] items-center gap-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg leading-6 text-ink">{title}</h3>
          {open ? null : (
            <p
              className={cn(
                "text-sm",
                status === "missing" ? "text-warning-ink" : "text-ink-2",
              )}
            >
              {summary}
            </p>
          )}
        </div>
        {status === "ready" ? <DoneMark>Ready</DoneMark> : null}
        {status === "missing" && open ? (
          <span className="shrink-0 rounded-full bg-warning-fill px-2.5 py-1 text-caption font-medium text-warning-ink">
            Missing
          </span>
        ) : null}
        <Button
          type="button"
          variant={open ? "ghost" : "secondary"}
          size="md"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${action} ${title}`}
          onClick={onToggle}
          className={cn("shrink-0", open ? "min-w-11 px-0" : "px-3.5 text-sm")}
        >
          {open ? (
            <ChevronUp className="h-[18px] w-[18px]" aria-hidden="true" />
          ) : (
            action
          )}
        </Button>
      </div>
      <div
        id={panelId}
        hidden={!open}
        className={cn("flex-col gap-5 pb-6 pt-1", open ? "flex" : "hidden")}
      >
        {children}
      </div>
    </div>
  );
};

/** "Where to find these": the numbered steps under a channel's fields. */
export const WhereToFind: React.FC<{ title: string; steps: string[] }> = ({
  title,
  steps,
}) => (
  <div className="flex flex-col gap-1.5">
    <p className="text-sm font-semibold text-ink">{title}</p>
    <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-ink-2">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  </div>
);
