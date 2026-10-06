import React, { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Dealer } from "../../types";
import { cn } from "../../utils/classNames";
import { SamplePhoto } from "./SamplePhoto";
import { SamplePost } from "./SamplePost";
import { sampleApproval, sampleSummary, type SampleMark } from "./sampleProof";

interface SampleProps {
  /** The saved record overlaid with the form's unsaved values. */
  draft: Dealer;
  mark: SampleMark;
  className?: string;
}

/** From `lg`: the sample post beside the form, with the section's part marked. */
export const SampleAside: React.FC<SampleProps> = ({ draft, mark, className }) => (
  <aside aria-label="Sample post" className={cn("min-w-0 flex-col gap-3.5", className)}>
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="font-sans text-lg leading-6 text-ink">On a post</h2>
      <p className="text-caption text-ink-2">Sample delivery post</p>
    </div>
    <SamplePost dealer={draft} mark={mark} />
  </aside>
);

/**
 * Below `lg`: one line under the section title (a thumbnail, "On a post",
 * what this section does to a post) that opens the full sample in place.
 */
export const SampleStrip: React.FC<SampleProps> = ({ draft, mark, className }) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const held = mark === "disclosure" && sampleApproval(draft).held;
  return (
    <div className={cn("min-w-0 flex-col gap-3", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="table-lit flex w-full items-center gap-3 rounded-md border border-hairline py-2.5 pl-2.5 pr-3 text-left"
      >
        <SamplePhoto dealer={draft} decorative className="w-[52px] shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            On a post
            {held ? (
              <span className="rounded-full bg-warning-fill px-2 py-0.5 text-caption font-medium text-warning-ink">
                Waiting for you
              </span>
            ) : null}
          </span>
          <span className="text-sm text-ink-2">{sampleSummary(draft, mark)}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-[18px] w-[18px] shrink-0 text-ink-2 transition-transform duration-180 ease-out motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      <div id={panelId} hidden={!open}>
        {open ? <SamplePost dealer={draft} mark={mark} /> : null}
      </div>
    </div>
  );
};
