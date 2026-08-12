import React from "react";

/**
 * Product identity: the car-roofline mark — the same geometry as
 * public/brand-mark.svg and every PWA/app icon — inlined so the tile can
 * follow the dealer's white-label brand color, beside the product wordmark.
 * The wordmark reads through the theme's primary text token so it works in
 * both Sunlight Mode and dark.
 */
export const Logo: React.FC<{ className?: string }> = ({
  className = "h-auto w-52",
}) => (
  <svg
    className={className}
    viewBox="0 0 276 44"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Dealer Social Post AI"
  >
    <g transform="scale(.3666667)" aria-hidden="true">
      <rect width="120" height="120" rx="26" fill="var(--brand-primary, #1e40af)" />
      <g transform="scale(0.234375)">
        <path
          d="M96 344 v-16 c0 -22 12 -36 33 -42 l50 -92 c16 -29 39 -43 70 -43 h54 c31 0 54 14 70 43 l50 92 c21 6 33 20 33 42 v16 z"
          fill="#f8fafc"
        />
        <path
          d="M196 268 l30 -55 c8 -14 18 -20 32 -20 h-6 v75 z"
          fill="var(--brand-primary, #1e40af)"
        />
        <path d="M246 193 h20 v75 h-20 z" fill="var(--brand-primary, #1e40af)" />
        <path
          d="M286 268 v-75 h-6 c14 0 24 6 32 20 l30 55 z"
          fill="var(--brand-primary, #1e40af)"
        />
      </g>
    </g>
    <text
      x="56"
      y="28"
      fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
      fontSize="18"
      fontWeight="800"
      letterSpacing="-0.5"
      fill="rgb(var(--color-text-primary, 244 247 252))"
    >
      Dealer Social Post AI
    </text>
  </svg>
);
