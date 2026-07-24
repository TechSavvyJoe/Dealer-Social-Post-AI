import React from "react";

/**
 * Product identity: a salesperson and customer share a vehicle-delivery moment
 * inside a social-post card, with a restrained AI polish point. The full
 * canonical name remains readable at narrow-phone sizes.
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
      <rect width="120" height="120" rx="28" fill="#07101f" />
      <rect x="8" y="8" width="104" height="104" rx="23" fill="#4f7cff" />
      <rect x="15" y="15" width="90" height="90" rx="17" fill="#07101f" />
      <path d="M33 81 39 61q2-6 8-6h26q6 0 8 6l6 20v8H33Z" fill="#4f7cff" />
      <path d="m46 61-4 12h36l-4-12Z" fill="#f8fafc" />
      <rect x="38" y="77" width="9" height="5" rx="2.5" fill="#f8fafc" />
      <rect x="73" y="77" width="9" height="5" rx="2.5" fill="#f8fafc" />
      <rect x="48" y="84" width="24" height="3" rx="1.5" fill="#cbdcff" />
      <circle cx="24" cy="48" r="7" fill="#f8fafc" />
      <path d="M16 88V66q0-9 8-9h1q8 0 8 9v22Z" fill="#f8fafc" />
      <path d="m30 61 23-15 5 8-25 18Z" fill="#f8fafc" />
      <circle cx="96" cy="48" r="7" fill="#cbdcff" />
      <path d="M87 88V66q0-9 8-9h1q8 0 8 9v22Z" fill="#cbdcff" />
      <path d="m90 61-23-15-5 8 25 18Z" fill="#cbdcff" />
      <circle cx="60" cy="48" r="5" fill="#67e8f9" />
      <circle cx="60" cy="48" r="2.3" fill="#07101f" />
      <rect x="58.5" y="53" width="3" height="9" rx="1.5" fill="#67e8f9" />
      <path d="m60 61 5 4-5 4-3-3 3-2-3-2Z" fill="#67e8f9" />
      <rect x="18" y="92" width="84" height="3" rx="1.5" fill="#26334a" />
      <circle cx="24" cy="101" r="4" fill="#4f7cff" />
      <rect x="33" y="98" width="32" height="6" rx="3" fill="#26334a" />
      <path d="m93 19 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="#67e8f9" />
    </g>
    <text
      x="56"
      y="28"
      fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
      fontSize="18"
      fontWeight="800"
      letterSpacing="-0.5"
      fill="#f8fafc"
    >
      Dealer Social Post AI
    </text>
  </svg>
);
