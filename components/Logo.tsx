import React from "react";

/**
 * Brand mark. Rewritten 2026-05-29 to align with the Dealer Trust system
 * (no indigo→purple gradient, sentence case in the marketing wordmark, tighter
 * letterforms). The logomark is a stylized aperture — geometry borrowed from
 * the social-post + camera concept this product lives at.
 *
 * Color is pulled from --brand-primary so the mark white-labels per dealer.
 */
export const Logo: React.FC<{ className?: string }> = ({ className = "w-32 h-32" }) => (
  <svg
    className={className}
    viewBox="0 0 200 40"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Dealer Social Post AI"
  >
    {/* Logomark — chamfered square aperture, solid brand color */}
    <g transform="translate(0, 0)">
      <rect
        x="2"
        y="2"
        width="36"
        height="36"
        rx="9"
        fill="var(--brand-primary, #1e40af)"
      />
      {/* Aperture cut */}
      <path
        d="M12 20 L20 12 L28 20 L20 28 Z"
        fill="var(--brand-foreground, #ffffff)"
        opacity="0.95"
      />
      {/* Soft inner accent */}
      <circle cx="20" cy="20" r="3" fill="var(--brand-primary, #1e40af)" />
    </g>

    {/* Wordmark — sentence case, tighter tracking, neutral white */}
    <g transform="translate(50, 0)">
      <text
        x="0"
        y="17"
        fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
        fontSize="10"
        fontWeight="600"
        letterSpacing="2"
        fill="#9aa3b8"
      >
        DEALER SOCIAL
      </text>
      <text
        x="0"
        y="34"
        fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
        fontSize="17"
        fontWeight="700"
        letterSpacing="-0.4"
        fill="#f4f7fc"
      >
        Post studio
      </text>
    </g>
  </svg>
);
