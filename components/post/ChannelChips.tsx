import React, { useId } from "react";
import { Check } from "lucide-react";
import { PlatformGlyph } from "../PlatformGlyph";
import type { StoreChannel } from "../../services/storeDefaults";

export interface ChannelChipsProps {
  channels: StoreChannel[];
  selectedId: string;
  sharedIds?: ReadonlySet<string>;
  disabled?: boolean;
  onSelect: (channel: StoreChannel) => void;
}

/** Shared pill chip classes for the Post screen's one-tap choices. */
export const chipClass = (selected: boolean): string =>
  "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors duration-120 disabled:cursor-not-allowed disabled:opacity-50 " +
  (selected
    ? "border-brand-fill bg-brand-fill text-brand-foreground"
    : "border-strong bg-panel-raised text-ink hover:border-ink-2");

export const ChannelChips: React.FC<ChannelChipsProps> = ({
  channels,
  selectedId,
  sharedIds,
  disabled = false,
  onSelect,
}) => {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-sm font-medium text-ink-2">
        Share to
      </span>
      <div className="flex min-w-0 flex-wrap gap-2">
        {channels.map((channel) => {
          const selected = channel.id === selectedId;
          const shared = sharedIds?.has(channel.id) ?? false;
          return (
            <button
              key={channel.id}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onSelect(channel)}
              className={chipClass(selected)}
            >
              {/* A 16 px mark: the glyph's own tile shadow is not part of the chip. */}
              <PlatformGlyph
                platformId={channel.id}
                label={channel.label}
                decorative
                size="sm"
                className="h-4 w-4 !shadow-none [&>svg]:h-3 [&>svg]:w-3"
              />
              <span>{channel.label}</span>
              {shared ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">, shared</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};
