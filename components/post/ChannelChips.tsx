import React from "react";
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

export const ChannelChips: React.FC<ChannelChipsProps> = ({
  channels,
  selectedId,
  sharedIds,
  disabled = false,
  onSelect,
}) => (
  <div className="flex flex-col gap-2.5" role="group" aria-label="Post to">
    <span className="text-[13px] font-semibold text-ink-2">Post to</span>
    <div className="grid min-w-0 grid-cols-2 gap-2 min-[380px]:grid-cols-3">
      {channels.map((channel) => {
        const selected = channel.id === selectedId;
        return (
          <button
            key={channel.id}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onSelect(channel)}
            className={
              "relative flex min-h-[88px] min-w-0 flex-col items-center justify-center gap-2 rounded-xl border px-2 py-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink/70 disabled:cursor-not-allowed disabled:opacity-50 " +
              (selected
                ? "border-brand-ink/60 bg-brand-tint text-ink ring-1 ring-brand-ink/20"
                : "border-hairline bg-panel-raised text-ink-2 hover:border-brand-ink/40 hover:text-ink")
            }
          >
            <PlatformGlyph
              platformId={channel.id}
              label={channel.label}
              decorative
              size="sm"
            />
            <span className="text-center leading-4">{channel.label}</span>
            {sharedIds?.has(channel.id) ? (
              <Check
                className="absolute right-2 top-2 h-3.5 w-3.5"
                aria-label="Shared"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  </div>
);
