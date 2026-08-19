import React from "react";

/**
 * Dealer Social Post AI's primary combination mark. The campaign-aperture DSP
 * monogram is a fixed product identity; dealer white-label colors remain
 * available elsewhere in the interface without recoloring the product mark.
 */
export const Logo: React.FC<{ className?: string }> = ({
  className = "h-auto w-52",
}) => (
  <svg
    className={className}
    viewBox="0 0 244 44"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Dealer Social Post AI"
  >
    <image href="/dsp-brand-mark-v3.svg" width="44" height="44" aria-hidden="true" />
    <text
      x="56"
      y="16"
      fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
      fontSize="10"
      fontWeight="700"
      letterSpacing="1.1"
      fill="rgb(var(--color-text-secondary, 185 195 213))"
      aria-hidden="true"
    >
      DEALER SOCIAL
    </text>
    <text
      x="56"
      y="36"
      fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
      fontSize="20"
      fontWeight="800"
      letterSpacing="-0.55"
      fill="rgb(var(--color-text-primary, 244 247 252))"
      aria-hidden="true"
    >
      POST <tspan fill="#ff6a4d">AI</tspan>
    </text>
  </svg>
);
