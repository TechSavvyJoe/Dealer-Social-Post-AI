import React, { useId, useMemo } from "react";
import { User } from "lucide-react";
import type { Dealer } from "../../types";
import { cn } from "../../utils/classNames";
import { SamplePhoto } from "./SamplePhoto";
import {
  composeSampleCaption,
  sampleApproval,
  sampleChannels,
  sampleNotes,
  type SampleMark,
  type SampleNote,
} from "./sampleProof";

export interface SamplePostProps {
  /** The saved record overlaid with the form's unsaved values. The caller builds it. */
  dealer: Dealer;
  mark: SampleMark;
  className?: string;
}

/**
 * The sample imitates a Facebook post, so its caption is set at Facebook's
 * own 15 px reading size (between the app's 14 and 16 px steps).
 */
const POST_TEXT = "text-[0.9375rem] leading-5.5";

/** The one mark: a 2 px brand-ink rule under the marked words, on every line they wrap to. */
const Marked: React.FC<{
  on: boolean;
  strong?: boolean;
  children: React.ReactNode;
}> = ({ on, strong = false, children }) =>
  on ? (
    <span
      data-mark=""
      className={cn("border-b-2 border-brand-ink pb-px", strong && "font-semibold")}
    >
      {children}
    </span>
  ) : (
    <>{children}</>
  );

/** The glyph beside a note: the same shape as the mark it explains. */
const NoteGlyph: React.FC<{ glyph: SampleNote["glyph"] }> = ({ glyph }) => {
  switch (glyph) {
    case "line":
      return (
        <span
          aria-hidden="true"
          data-glyph="line"
          className="mt-2.5 h-0 w-[18px] shrink-0 border-b-2 border-brand-ink"
        />
      );
    case "dash":
      return (
        <span
          aria-hidden="true"
          data-glyph="dash"
          className="mt-1 h-3 w-[18px] shrink-0 rounded-[3px] border-2 border-dashed border-brand-ink"
        />
      );
    case "strip":
      return (
        <span
          aria-hidden="true"
          data-glyph="strip"
          className="mt-[5px] h-2.5 w-[18px] shrink-0 rounded-full border border-warning-ink bg-warning-fill"
        />
      );
    default:
      return (
        <span aria-hidden="true" data-glyph="none" className="w-[18px] shrink-0" />
      );
  }
};

/**
 * A sample delivery post, built by the functions that build real posts, with
 * the part the current settings section controls marked. Live: it renders
 * from `dealer` alone, holds no state and makes no request. The caller owns
 * the "On a post" heading.
 */
export const SamplePost: React.FC<SamplePostProps> = ({ dealer, mark, className }) => {
  const channelsLabelId = useId();
  const caption = useMemo(() => composeSampleCaption(dealer), [dealer]);
  const notes = useMemo(() => sampleNotes(dealer, mark), [dealer, mark]);
  const held = useMemo(() => sampleApproval(dealer).held, [dealer]);
  const channels = useMemo(
    () => (mark === "mention" ? sampleChannels(dealer) : []),
    [dealer, mark],
  );

  // Notes line up in one column when any of them has a glyph; a list of
  // plain sentences needs no gutter.
  const gutter = notes.some((note) => note.glyph !== "none");
  const closing = mark === "closing";

  return (
    <div className={cn("flex min-w-0 flex-col gap-3.5", className)}>
      <div className="table-lit rounded-lg border border-hairline p-5">
        <div data-sample-print="" className="print overflow-hidden bg-panel-raised">
          <div className="flex items-center gap-2.5 px-3.5 py-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-strong bg-overlay"
            >
              <User className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.75} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[0.9375rem] font-semibold leading-5 text-ink">
                Your salesperson
              </span>
              <span className="text-caption text-ink-2">Facebook post</span>
            </span>
          </div>

          {mark === "disclosure" && held ? (
            <p
              data-sample-waiting=""
              className="bg-warning-fill px-3.5 py-1.5 text-caption font-medium text-warning-ink"
            >
              Waiting for you
            </p>
          ) : null}

          <SamplePhoto
            dealer={dealer}
            marked={mark === "look"}
            className="rounded-none border-0"
          />

          <div
            data-sample-caption=""
            className="flex flex-col gap-2.5 whitespace-pre-line wrap-break-word p-3.5"
          >
            {caption.disclosure ? (
              <p data-part="disclosure" className="text-caption text-ink-2">
                <Marked on={mark === "disclosure"}>{caption.disclosure}</Marked>
              </p>
            ) : null}
            <p data-part="body" className={cn(POST_TEXT, "text-ink")}>
              {caption.body}
            </p>
            {caption.footer ? (
              <p data-part="footer" className={cn(POST_TEXT, "text-ink")}>
                <Marked on={closing}>{caption.footer}</Marked>
              </p>
            ) : null}
            {caption.hashtags ? (
              <p data-part="hashtags" className="text-sm text-ink-2">
                <Marked on={closing}>{caption.hashtags}</Marked>
              </p>
            ) : null}
            {caption.mention ? (
              <p data-part="mention" className={cn(POST_TEXT, "text-ink")}>
                <Marked on={mark === "mention"} strong>
                  {caption.mention}
                </Marked>
              </p>
            ) : null}
            {/* A safeguard: if the copy path writes a hashtag line under the
                page tag, it is copied, so it is shown; unmarked because no
                setting here sets it. Absent when the copied text ends with
                the tag. */}
            {caption.afterMention ? (
              <p data-part="after-mention" className="text-sm text-ink-2">
                {caption.afterMention}
              </p>
            ) : null}
            {caption.compliance ? (
              <p data-part="compliance" className="text-caption text-ink-2">
                {caption.compliance}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <ul className="flex flex-col gap-3.5" data-sample-notes="">
        {notes.map((note) => (
          <li key={`${note.glyph}:${note.text}`} className="flex items-start gap-2.5">
            {gutter ? <NoteGlyph glyph={note.glyph} /> : null}
            <p className="min-w-0 text-sm text-ink-2">{note.text}</p>
          </li>
        ))}
      </ul>

      {channels.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-hairline pt-3.5">
          <p id={channelsLabelId} className="text-sm text-ink-2">
            Your team can share this to
          </p>
          <ul className="flex flex-wrap gap-2" aria-labelledby={channelsLabelId}>
            {channels.map((label) => (
              <li
                key={label}
                className="rounded-full border border-strong px-3 py-1 text-sm font-medium text-ink"
              >
                {label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};
