import React, { useId } from "react";
import type { Dealer, LogoCorner, SignatureLook } from "../../types";
import { cn } from "../../utils/classNames";
import { SAMPLE_PHOTO_ALT, sampleLogo, sampleLook } from "./sampleProof";

export interface SamplePhotoProps {
  dealer: Dealer;
  /** Draw this Look instead of the dealer's signature look (the three choice prints). */
  look?: SignatureLook;
  /** Outline the headline and the logo the way the Creative sample does. */
  marked?: boolean;
  /** Decorative use (choice prints, thumbnails): empty alt, aria-hidden treatment. */
  decorative?: boolean;
  /** The photo's alt text when it is not decorative. Defaults to the sample's own description. */
  alt?: string;
  className?: string;
}

/**
 * The illustration's own colors. A Look treatment is a picture of a designed
 * post, printed onto the photo, not app chrome over a user's photo: it looks
 * the same in the dark theme and in Sunlight Mode, exactly as the post would,
 * so these few values are fixed instead of theme tokens.
 */
const PRINT_PALETTE = {
  /** Headline type on the photo. */
  type: "#ffffff",
  /** The gradient that keeps the headline legible. */
  shade: "#000000",
  /** Hometown's warm off-white headline band, and its type. */
  band: "#f6f3ee",
  bandType: "#1b1d1f",
} as const;

/** The bundled sample: a synthetic 720 by 900 (4:5) delivery photo. */
const SAMPLE_SRC = "/samples/delivery.webp";
const SAMPLE_WIDTH = 720;
const SAMPLE_HEIGHT = 900;

/**
 * The overlay is drawn on a 400 by 500 canvas (the print's 4:5), so every
 * size below is a fraction of the print and scales from a 52 px thumbnail to
 * the 380 px sample. Headlines carry a fixed `textLength`, so the mark under
 * them is exactly as long as the type in any font fallback.
 */
const VIEW_W = 400;
const VIEW_H = 500;

/** The logo's distance from the print's edges, as a fraction of its width. */
const LOGO_INSET = 0.04;

/** The part of the print a Look's headline occupies, so the logo can clear it. */
interface HeadlineZone {
  edge: "top" | "bottom";
  /** "left": only the left corner on that edge collides; "full": both do. */
  span: "left" | "full";
  /** Depth of the headline from that edge, in canvas units. */
  depth: number;
}

const HEADLINE_ZONES: Record<SignatureLook, HeadlineZone> = {
  showroom: { edge: "bottom", span: "left", depth: 64 },
  hometown: { edge: "bottom", span: "full", depth: 76 },
  turbo: { edge: "top", span: "left", depth: 116 },
};

/**
 * Where the logo sits: its saved corner, lifted past the headline when the
 * Look's type occupies that corner, so the illustration never stacks the two.
 * Percent offsets: horizontal ones are of the width, vertical ones of the
 * height (4:5), so the inset reads the same on every side.
 */
const logoPosition = (
  corner: LogoCorner,
  scale: number,
  look: SignatureLook | undefined,
): React.CSSProperties => {
  const [vertical, horizontal] = corner.split("_") as [
    "top" | "bottom",
    "left" | "right",
  ];
  const insetX = LOGO_INSET * 100;
  const insetY = ((LOGO_INSET * VIEW_W) / VIEW_H) * 100;
  const zone = look ? HEADLINE_ZONES[look] : null;
  const collides =
    zone !== null &&
    zone.edge === vertical &&
    (zone.span === "full" || horizontal === "left");
  const offsetY = collides ? (zone.depth / VIEW_H) * 100 + insetY : insetY;
  const percent = (value: number) => `${Number(value.toFixed(2))}%`;
  return {
    width: percent(scale * 100),
    [horizontal]: percent(insetX),
    [vertical]: percent(offsetY),
  };
};

/** A 2 px brand-ink rule under a headline, the same 2 px at every print size. */
const HeadlineMark: React.FC<{ x: number; y: number; length: number }> = ({
  x,
  y,
  length,
}) => (
  <line
    data-mark="headline"
    x1={x}
    y1={y}
    x2={x + length}
    y2={y}
    className="stroke-brand-ink"
    strokeWidth={2}
    vectorEffect="non-scaling-stroke"
  />
);

/** Showroom: a soft dark gradient rising from the bottom, "Just delivered" lower left. */
const ShowroomTreatment: React.FC<{ gradientId: string; marked: boolean }> = ({
  gradientId,
  marked,
}) => (
  <>
    <defs>
      <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stopColor={PRINT_PALETTE.shade} stopOpacity={0.74} />
        <stop offset="1" stopColor={PRINT_PALETTE.shade} stopOpacity={0} />
      </linearGradient>
    </defs>
    <rect x={0} y={345} width={VIEW_W} height={155} fill={`url(#${gradientId})`} />
    <text
      x={23}
      y={471}
      className="font-sans"
      fontSize={30}
      fontWeight={500}
      textLength={189}
      lengthAdjust="spacing"
      fill={PRINT_PALETTE.type}
    >
      Just delivered
    </text>
    {marked ? <HeadlineMark x={23} y={481} length={189} /> : null}
  </>
);

/** Hometown: a warm off-white band across the bottom with dark type. */
const HometownTreatment: React.FC<{ marked: boolean }> = ({ marked }) => (
  <>
    <rect x={0} y={424} width={VIEW_W} height={76} fill={PRINT_PALETTE.band} />
    <text
      x={22}
      y={472}
      className="font-sans"
      fontSize={30}
      fontWeight={600}
      textLength={290}
      lengthAdjust="spacing"
      fill={PRINT_PALETTE.bandType}
    >
      Welcome to the family
    </text>
    {marked ? <HeadlineMark x={22} y={482} length={290} /> : null}
  </>
);

/**
 * Turbo: a dark gradient from the top, "SOLD" in the display face slanted
 * upper left with a hard drop shadow, and a short slanted bar under it. The
 * slant is a skew, not a synthesized italic, so it is the same in every
 * browser (only upright Barlow faces are bundled).
 */
const TurboTreatment: React.FC<{ gradientId: string; marked: boolean }> = ({
  gradientId,
  marked,
}) => (
  <>
    <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={PRINT_PALETTE.shade} stopOpacity={0.66} />
        <stop offset="1" stopColor={PRINT_PALETTE.shade} stopOpacity={0} />
      </linearGradient>
    </defs>
    <rect x={0} y={0} width={VIEW_W} height={180} fill={`url(#${gradientId})`} />
    <g transform="translate(22 76) skewX(-12)">
      <text
        x={4.5}
        y={4.5}
        className="font-display"
        fontSize={64}
        fontWeight={600}
        fill={PRINT_PALETTE.shade}
        fillOpacity={0.55}
      >
        SOLD
      </text>
      <text
        x={0}
        y={0}
        className="font-display"
        fontSize={64}
        fontWeight={600}
        fill={PRINT_PALETTE.type}
      >
        SOLD
      </text>
    </g>
    <polygon points="26,87 165,87 161,98 22,98" fill={PRINT_PALETTE.type} />
    {marked ? <HeadlineMark x={22} y={108} length={143} /> : null}
  </>
);

/**
 * The sample photo as a print: the bundled delivery photo, the Look drawn
 * over it as one SVG illustration, and the store's own logo in its saved
 * corner (bottom-right when none is saved: see `sampleLogo`). A store without
 * a Look gets the plain photo; a store without a logo gets no logo, never a
 * stand-in wordmark.
 */
export const SamplePhoto: React.FC<SamplePhotoProps> = ({
  dealer,
  look,
  marked = false,
  decorative = false,
  alt,
  className,
}) => {
  const shown = look ?? sampleLook(dealer);
  const logo = sampleLogo(dealer);
  // Several prints share a page (three choice prints, the sample, the phone
  // thumbnail), so each needs its own gradient id; React's ids carry
  // punctuation that url(#...) references do not need.
  const gradientId = `sample-shade-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;

  return (
    <div
      data-look={shown ?? "none"}
      aria-hidden={decorative || undefined}
      className={cn("print relative overflow-hidden bg-panel-raised", className)}
    >
      <img
        src={SAMPLE_SRC}
        width={SAMPLE_WIDTH}
        height={SAMPLE_HEIGHT}
        loading="lazy"
        decoding="async"
        alt={decorative ? "" : alt || SAMPLE_PHOTO_ALT}
        className={cn(
          "block aspect-4/5 h-auto w-full object-cover object-[46%_50%]",
          // The Look's photo finish: Hometown a little warmer, Turbo a little
          // more contrast. Part of the illustration, like the overlay.
          shown === "hometown" && "saturate-[1.12] sepia-[.12]",
          shown === "turbo" && "contrast-[1.14] saturate-[1.2]",
        )}
      />
      {shown ? (
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          aria-hidden="true"
          focusable="false"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {shown === "showroom" ? (
            <ShowroomTreatment gradientId={gradientId} marked={marked} />
          ) : shown === "hometown" ? (
            <HometownTreatment marked={marked} />
          ) : (
            <TurboTreatment gradientId={gradientId} marked={marked} />
          )}
        </svg>
      ) : null}
      {logo ? (
        // Not lazy: the logo's height is unknown until it loads, and a lazy
        // image with no reserved size is never fetched inside the print. It
        // is small, and the photo beside it is the lazy part.
        <img
          src={logo.src}
          alt=""
          data-sample-logo=""
          data-corner={logo.corner}
          decoding="async"
          style={logoPosition(logo.corner, logo.scale, shown)}
          className={cn(
            "pointer-events-none absolute h-auto object-contain",
            marked &&
              "rounded-[3px] outline-dashed outline-2 outline-offset-2 outline-brand-ink",
          )}
        />
      ) : null}
    </div>
  );
};
