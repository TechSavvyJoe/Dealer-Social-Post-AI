import React, { useRef } from "react";
import { CarFront, KeyRound, MapPin, Tag, UsersRound, Wrench } from "lucide-react";
import type { BrandCategoryId } from "../../types";
import type { HomeTile } from "../../services/storeDefaults";
import { cn } from "../../utils/classNames";

const ICONS: Record<BrandCategoryId, React.ComponentType<{ className?: string }>> = {
  deliveries: KeyRound,
  inventory: CarFront,
  service: Wrench,
  promotions: Tag,
  community: MapPin,
  team: UsersRound,
};

const PHOTO_SRC: Record<BrandCategoryId, string> = {
  deliveries: "/category/deliveries.webp",
  inventory: "/category/inventory.webp",
  service: "/category/service.webp",
  promotions: "/category/promotions.webp",
  community: "/category/community.webp",
  team: "/category/team.webp",
};

export interface CategoryTilesProps {
  tiles: HomeTile[];
  usualCategory?: string;
  disabled?: boolean;
  onFile: (file: File, tile: HomeTile) => void;
  onSelect?: (tile: HomeTile) => boolean;
}

export const CategoryTiles: React.FC<CategoryTilesProps> = ({
  tiles,
  usualCategory,
  disabled,
  onFile,
  onSelect,
}) => {
  const cameraRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const libraryRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>, tile: HomeTile) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onFile(file, tile);
  };

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
      {tiles.map((tile) => {
        const Icon = ICONS[tile.categoryId];
        const usual = usualCategory === tile.categoryId;
        return (
          <article
            key={tile.scenarioId}
            className="group relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-hairline bg-panel-raised transition-[border-color,transform] duration-180 hover:-translate-y-0.5 hover:border-strong"
          >
            <input
              ref={(node) => {
                cameraRefs.current[tile.scenarioId] = node;
              }}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only md:hidden"
              aria-label={`Take a photo for ${tile.label}`}
              onChange={(event) => handleChange(event, tile)}
            />
            <input
              ref={(node) => {
                libraryRefs.current[tile.scenarioId] = node;
              }}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label={`Choose a photo for ${tile.label}`}
              onChange={(event) => handleChange(event, tile)}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (onSelect?.(tile)) return;
                const mobile = window.matchMedia?.("(max-width: 767px)").matches;
                (mobile ? cameraRefs : libraryRefs).current[tile.scenarioId]?.click();
              }}
              className={cn(
                "relative flex min-h-[176px] flex-1 flex-col items-stretch overflow-hidden text-left text-ink md:min-h-[214px]",
                "transition-colors disabled:cursor-wait disabled:opacity-50",
              )}
            >
              <span
                className="relative block h-[88px] shrink-0 overflow-hidden border-b border-hairline bg-panel md:h-[112px]"
                aria-hidden="true"
              >
                <img
                  src={PHOTO_SRC[tile.categoryId]}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-320 group-hover:scale-[1.03]"
                />
                <span className="absolute inset-0 bg-overlay/10" />
                <span className="absolute bottom-0 left-0 top-0 w-1 bg-brand-fill" />
              </span>
              <span className="flex flex-1 items-center gap-3 px-3 py-3 md:px-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-brand-tint text-brand-ink">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-xl font-semibold leading-tight md:text-2xl">
                    {tile.label}
                  </span>
                  <span className="mt-0.5 block text-sm leading-tight text-ink-2">
                    {tile.blurb}
                  </span>
                </span>
                {usual ? (
                  <span className="hidden shrink-0 text-xs font-semibold text-brand-ink lg:block">
                    Your usual
                  </span>
                ) : null}
              </span>
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => libraryRefs.current[tile.scenarioId]?.click()}
              className="min-h-11 border-t border-hairline px-2 text-xs font-semibold text-ink hover:bg-fill-subtle md:hidden"
            >
              Choose from library
            </button>
          </article>
        );
      })}
    </div>
  );
};
