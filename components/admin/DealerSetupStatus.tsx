import React, { useId, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import type { Dealer } from "../../types";
import * as db from "../../services/database";
import { useAppStore } from "../../stores/appStore";
import { cn } from "../../utils/classNames";
import { toUiMessage } from "../../utils/errorMessages";
import {
  dealerSetupStatus,
  missingSummary,
  SETUP_STATE_LABELS,
  type SetupRow,
} from "../../utils/dealerSetupStatus";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

const CREATIVE_SYSTEM_DESCRIPTION =
  "Uses the store's signature Look and playful style for every post instead of the classic style list.";

const badgeVariant = (row: SetupRow): "success" | "warning" | "neutral" => {
  if (row.state === "ready") return "success";
  if (row.attention) return "warning";
  return "neutral";
};

/** The visual half of the role="switch" button; the button carries the state. */
const SwitchTrack: React.FC<{ on: boolean; muted: boolean }> = ({ on, muted }) => (
  <span
    aria-hidden="true"
    className={cn(
      "flex h-6 w-11 shrink-0 items-center rounded-full border px-0.5 transition-colors duration-120 ease-out motion-reduce:transition-none",
      on ? "border-brand-fill bg-brand-fill" : "border-strong bg-fill-hover",
      muted && "opacity-50",
    )}
  >
    <span
      className={cn(
        "block h-5 w-5 rounded-full transition-transform duration-120 ease-out motion-reduce:transition-none",
        on ? "translate-x-[18px] bg-brand-foreground" : "bg-ink-2",
      )}
    />
  </span>
);

/**
 * The system administrator's per-store switch for the streamlined creative
 * system. The server accepts `creative_system_v2` only from the system
 * administrator; this control is never rendered for any other role.
 */
const CreativeSystemSwitch: React.FC<{
  dealer: Dealer;
  lookChosen: boolean;
  unreportedNote: string | null;
}> = ({ dealer, lookChosen, unreportedNote }) => {
  const role = useAppStore((s) => s.role);
  const queryClient = useQueryClient();
  const toast = useToast();
  const labelId = useId();
  const descriptionId = useId();
  const [requested, setRequested] = useState<boolean | null>(null);

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      const formData = new FormData();
      // The dealer PATCH requires a non-empty name whenever the field is
      // present; send the current one so the save changes only the switch.
      formData.append("name", dealer.name);
      formData.append("creative_system_v2", next ? "true" : "false");
      await db.updateDealerWithFile(dealer.id, formData);
      return next;
    },
    onSuccess: (next) => {
      // Reflect the saved value at once so the switch never flips back while
      // the list refetches, then refresh the list from the server.
      queryClient.setQueryData<Dealer[]>(["dealers"], (list) =>
        list?.map((item) =>
          item.id === dealer.id ? { ...item, creative_system_v2: next } : item,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: ["dealers"] });
      toast.success(
        `Streamlined creative system turned ${next ? "on" : "off"} for ${dealer.name}.`,
      );
    },
    onSettled: () => setRequested(null),
  });

  if (role !== "super_admin") return null;

  const reported = typeof dealer.creative_system_v2 === "boolean";
  const checked = requested ?? dealer.creative_system_v2 === true;
  const saving = mutation.isPending;
  const locked = saving || !reported;

  const toggle = () => {
    if (locked) return;
    const next = !checked;
    mutation.reset();
    setRequested(next);
    mutation.mutate(next);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        aria-disabled={locked || undefined}
        onClick={toggle}
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-4 rounded-sm bg-fill-subtle px-3 py-3 text-left transition-colors duration-120 ease-out",
          locked ? "cursor-not-allowed" : "hover:bg-fill-hover",
        )}
      >
        <span className="min-w-0">
          <span id={labelId} className="block text-sm font-semibold text-ink">
            Streamlined creative system
          </span>
          <span id={descriptionId} className="mt-0.5 block text-caption text-ink-2">
            {CREATIVE_SYSTEM_DESCRIPTION}
          </span>
        </span>
        <SwitchTrack on={checked} muted={!reported} />
      </button>
      {/* Always mounted so screen readers announce the text when it changes. */}
      <p role="status" className={saving ? "px-3 text-caption text-ink-2" : "sr-only"}>
        {saving ? "Saving…" : ""}
      </p>
      {mutation.isError ? (
        <p role="alert" className="px-3 text-sm text-error-ink">
          {toUiMessage(mutation.error, "The setting wasn't saved. Try again.")}
        </p>
      ) : null}
      {!reported ? (
        <p className="px-3 text-caption text-ink-2">{unreportedNote}</p>
      ) : checked && !lookChosen ? (
        <p className="px-3 text-caption text-ink-2">
          No signature look is chosen yet, so posts use Showroom until the manager picks
          one.
        </p>
      ) : null}
    </div>
  );
};

const SetupRowItem: React.FC<{ row: SetupRow }> = ({ row }) => (
  <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)_auto]">
    <p className="order-1 text-sm font-medium text-ink">{row.label}</p>
    <span className="order-2 justify-self-end sm:order-3">
      <Badge variant={badgeVariant(row)}>{SETUP_STATE_LABELS[row.state]}</Badge>
    </span>
    <div className="order-3 col-span-2 min-w-0 sm:order-2 sm:col-span-1">
      {row.value.map((line, index) => (
        <p
          key={`${row.id}-${index}`}
          className={
            row.id === "voice"
              ? "line-clamp-3 break-words text-sm text-ink-2"
              : "break-words text-sm text-ink-2"
          }
        >
          {row.swatch && index === row.value.length - 1 ? (
            <span
              aria-hidden="true"
              className="mr-1.5 inline-block h-3.5 w-3.5 rounded-full border border-hairline align-[-2px]"
              style={{ backgroundColor: row.swatch }}
            />
          ) : null}
          {line}
        </p>
      ))}
      {row.guidance ? (
        <p
          className={
            row.value.length
              ? "mt-1 text-caption text-ink-2"
              : "text-caption text-ink-2"
          }
        >
          {row.guidance}
        </p>
      ) : null}
    </div>
  </li>
);

/**
 * One store's setup at a glance (easy view: the count and what is missing)
 * with the full list and the creative-system switch behind "Setup"
 * (advanced view). Everything is read from the saved dealer record.
 */
export const DealerSetupStatus: React.FC<{ dealer: Dealer }> = ({ dealer }) => {
  const status = useMemo(() => dealerSetupStatus(dealer), [dealer]);
  const [open, setOpen] = useState(false);
  const panelId = `dealer-setup-${dealer.id}`;
  const complete = status.missing.length === 0;
  const lookRow = status.rows.find((row) => row.id === "look");
  const creativeRow = status.rows.find((row) => row.id === "creative_system");

  return (
    <div className="border-t border-hairline pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            {complete ? (
              <Check className="h-4 w-4 shrink-0 text-success-ink" aria-hidden="true" />
            ) : null}
            {status.summary}
          </p>
          {complete ? null : (
            <p className="mt-0.5 text-caption text-ink-2">
              Missing: {missingSummary(status)}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="md"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`Setup for ${dealer.name}`}
          onClick={() => setOpen((value) => !value)}
          rightIcon={
            <ChevronDown
              className={cn(
                "transition-transform duration-180 ease-out motion-reduce:transition-none",
                open && "rotate-180",
              )}
            />
          }
        >
          Setup
        </Button>
      </div>
      {open ? (
        <div id={panelId} className="mt-3 space-y-3">
          <CreativeSystemSwitch
            dealer={dealer}
            lookChosen={lookRow?.state === "ready"}
            unreportedNote={creativeRow?.guidance ?? null}
          />
          <ul className="divide-y divide-hairline border-t border-hairline">
            {status.rows
              .filter((row) => row.id !== "creative_system")
              .map((row) => (
                <SetupRowItem key={row.id} row={row} />
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};
