import React, { useEffect, useId, useRef, useState } from "react";
import {
  CarFront,
  ChevronRight,
  KeyRound,
  MapPin,
  Tag,
  UsersRound,
  Wrench,
} from "lucide-react";
import type { BrandCategoryId } from "../../types";
import type { HomeTile } from "../../services/storeDefaults";
import { cn } from "../../utils/classNames";

/** Shown only when a category photo cannot load (offline, missing asset). */
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

/** Phones get the camera; wider screens get the file picker. Matches Tailwind `md`. */
const PHONE_QUERY = "(max-width: 767px)";

const isPhoneViewport = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  Boolean(window.matchMedia(PHONE_QUERY)?.matches);

/** The tile's accessible name has to follow the viewport, so subscribe to it. */
const useIsPhone = (): boolean => {
  const [isPhone, setIsPhone] = useState(isPhoneViewport);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(PHONE_QUERY);
    if (!query) return;
    const update = () => setIsPhone(Boolean(query.matches));
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    // Safari < 14 only has the legacy listener API.
    query.addListener?.(update);
    return () => query.removeListener?.(update);
  }, []);

  return isPhone;
};

const TilePhoto: React.FC<{ categoryId: BrandCategoryId }> = ({ categoryId }) => {
  const [failed, setFailed] = useState(false);
  const Icon = ICONS[categoryId];

  return (
    <span
      className="absolute inset-0 block overflow-hidden bg-panel"
      aria-hidden="true"
    >
      {failed ? (
        <span
          data-testid="tile-photo-fallback"
          className="absolute inset-0 grid place-items-center text-ink-3"
        >
          <Icon className="h-6 w-6" />
        </span>
      ) : (
        <img
          src={PHOTO_SRC[categoryId]}
          alt=""
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      )}
    </span>
  );
};

export interface CategoryTilesProps {
  tiles: HomeTile[];
  usualCategory?: string;
  disabled?: boolean;
  /**
   * A photo is already waiting (dropped, or chosen from the library): the next
   * tile tap assigns it a category instead of opening the camera or picker.
   */
  photoWaiting?: boolean;
  onFile: (file: File, tile: HomeTile) => void;
  onSelect?: (tile: HomeTile) => boolean;
}

export const CategoryTiles: React.FC<CategoryTilesProps> = ({
  tiles,
  usualCategory,
  disabled,
  photoWaiting,
  onFile,
  onSelect,
}) => {
  const cameraRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const libraryRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const isPhone = useIsPhone();
  const idPrefix = useId();

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>, tile: HomeTile) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onFile(file, tile);
  };

  const action = photoWaiting
    ? "use this photo"
    : isPhone
      ? "take a photo"
      : "choose a photo";

  return (
    <div className="grid grid-cols-2 gap-2.5" aria-busy={disabled ? true : undefined}>
      {tiles.map((tile, index) => {
        const usual = usualCategory === tile.categoryId;
        const blurbId = `${idPrefix}-blurb-${index}`;
        const usualId = `${idPrefix}-usual-${index}`;
        return (
          <article
            key={tile.scenarioId}
            className={cn(
              "relative flex min-w-0",
              (tile.categoryId === "deliveries" || tile.categoryId === "team") &&
                "col-span-2",
            )}
          >
            {/* Opened by the tile on phones. Kept out of the tab and screen-reader
                order: the tile button is the one control. */}
            <input
              ref={(node) => {
                cameraRefs.current[tile.scenarioId] = node;
              }}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only md:hidden"
              tabIndex={-1}
              aria-hidden="true"
              aria-label={`Take a photo for ${tile.label}`}
              onChange={(event) => handleChange(event, tile)}
            />
            {/* Opened by the tile on wider screens. Phones choose from the
                library through Home's single "Choose from library" row. */}
            <input
              ref={(node) => {
                libraryRefs.current[tile.scenarioId] = node;
              }}
              type="file"
              accept="image/*"
              className="sr-only hidden md:block"
              tabIndex={-1}
              aria-hidden="true"
              aria-label={`Choose a photo for ${tile.label}`}
              onChange={(event) => handleChange(event, tile)}
            />
            <button
              type="button"
              disabled={disabled}
              aria-label={`${tile.label}: ${action}`}
              aria-describedby={usual ? `${blurbId} ${usualId}` : blurbId}
              onClick={() => {
                if (onSelect?.(tile)) return;
                (isPhoneViewport() ? cameraRefs : libraryRefs).current[
                  tile.scenarioId
                ]?.click();
              }}
              className={cn(
                "group relative flex min-h-[112px] w-full flex-1 flex-col justify-end overflow-hidden text-left text-photo-ink sm:min-h-[152px]",
                tile.categoryId === "deliveries" && "min-h-[136px] sm:min-h-[220px]",
                tile.categoryId === "team" && "min-h-[92px] sm:min-h-[140px]",
                "rounded-lg border border-strong/60 bg-panel transition-colors duration-120 hover:border-brand-ink",
                "disabled:cursor-wait disabled:opacity-50 disabled:hover:border-hairline",
              )}
            >
              <TilePhoto categoryId={tile.categoryId} />
              <span
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-photo-shade/95 via-photo-shade/25 to-transparent"
              />
              <span className="relative flex items-end gap-2 px-3.5 pb-3 pt-10">
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-display text-[17px] font-semibold leading-[22px]">
                    {tile.label}
                  </span>
                  <span
                    id={blurbId}
                    className="mt-1 block text-[12px] leading-4 text-photo-ink/85"
                  >
                    {tile.blurb}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-photo-ink/30 bg-photo-shade/25"
                >
                  <ChevronRight className="h-4 w-4" />
                </span>
                {usual ? (
                  <span
                    id={usualId}
                    className="hidden shrink-0 text-xs font-semibold text-brand-ink lg:block"
                  >
                    Your usual
                  </span>
                ) : null}
              </span>
            </button>
          </article>
        );
      })}
    </div>
  );
};
