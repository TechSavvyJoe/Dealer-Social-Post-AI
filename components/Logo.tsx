import React from "react";

/**
 * Product identity: the social-post vehicle mark — the same geometry as
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
      <rect x="20" y="15" width="80" height="90" rx="19" fill="#f8fafc" />
      <rect
        x="27"
        y="22"
        width="66"
        height="57"
        rx="13"
        fill="var(--brand-primary-700, #1e3a8a)"
      />
      <path
        d="M33 66v-2.5c0-3.7 2.2-6.5 6.1-7.6l5-10.3c2.3-4.7 6-6.9 11.2-6.9h9.4c5.2 0 8.9 2.2 11.2 6.9l5 10.3c3.9 1.1 6.1 3.9 6.1 7.6V66H33Z"
        fill="#f8fafc"
      />
      <path
        d="m47.1 55.2 4-8.1c.9-1.8 2.1-2.6 4.2-2.6h9.4c2.1 0 3.3.8 4.2 2.6l4 8.1H47.1Z"
        fill="var(--brand-primary, #1e40af)"
      />
      <path
        d="m82.5 28.5 2.1 5.4 5.4 2.1-5.4 2.1-2.1 5.4-2.1-5.4-5.4-2.1 5.4-2.1 2.1-5.4Z"
        fill="#67e8f9"
      />
      <rect
        x="30"
        y="86"
        width="37"
        height="5"
        rx="2.5"
        fill="var(--brand-primary, #1e40af)"
      />
      <rect x="30" y="95" width="24" height="3.5" rx="1.75" fill="#93c5fd" />
      <circle cx="87" cy="91" r="6" fill="#dbeafe" />
      <path
        d="m84.5 91 1.7 1.8 3.7-4"
        fill="none"
        stroke="var(--brand-primary, #1e40af)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
