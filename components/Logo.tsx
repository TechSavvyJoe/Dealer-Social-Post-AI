import React from "react";

/**
 * Dealer Social Post AI's primary combination mark: a bold D whose counter is
 * a 4:5 print, cut cleanly out of the letter. Rendered inline (not as an
 * <image> reference) so its fills follow the active theme's tokens instead of
 * the fixed colors baked into public/dsp-brand-mark-v4.svg.
 */
export const Logo: React.FC<{
  className?: string;
  markOnly?: boolean;
  size?: number;
  /** `onBrand` renders the lockup in white for a brand-coloured surface. */
  tone?: "default" | "onBrand";
}> = ({ className, markOnly = false, size = 40, tone = "default" }) => {
  const onBrand = tone === "onBrand";
  const tile = onBrand ? "rgba(255,255,255,0.14)" : "rgb(var(--panel))";
  const tileEdge = onBrand ? "rgba(255,255,255,0.22)" : "rgb(var(--hairline))";
  const print = onBrand ? "rgba(255,255,255,0.28)" : "rgb(var(--panel-raised))";
  const ink = onBrand ? "#ffffff" : "rgb(var(--ink))";
  return (
    <span role="img" aria-label="Dealer Social Post AI" className={className}>
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect width="120" height="120" rx="26" fill={tile} />
        <rect
          x="0.5"
          y="0.5"
          width="119"
          height="119"
          rx="25.5"
          fill="none"
          stroke={tileEdge}
        />
        <rect x="47" y="40" width="32" height="40" rx="4" fill={print} />
        <path
          fill={ink}
          fillRule="evenodd"
          d="M37 25H59A35 35 0 0 1 94 60A35 35 0 0 1 59 95H37A6 6 0 0 1 31 89V31A6 6 0 0 1 37 25ZM51 40H75A4 4 0 0 1 79 44V76A4 4 0 0 1 75 80H51A4 4 0 0 1 47 76V44A4 4 0 0 1 51 40Z"
        />
      </svg>
      {!markOnly && (
        <span
          aria-hidden="true"
          className={
            onBrand
              ? "font-display font-semibold text-xl text-brand-foreground tracking-[-0.01em] whitespace-nowrap"
              : "font-display font-semibold text-xl text-ink tracking-[-0.01em] whitespace-nowrap"
          }
        >
          Dealer Social Post AI
        </span>
      )}
    </span>
  );
};
