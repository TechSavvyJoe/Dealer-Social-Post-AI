import React from 'react';

export const Logo: React.FC<{ className?: string }> = ({ className = 'w-32 h-32' }) => (
  <svg 
    className={className} 
    viewBox="0 0 184 40" 
    xmlns="http://www.w3.org/2000/svg" 
    aria-label="Dealer Social Post AI Logo"
  >
    <defs>
      <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style={{ stopColor: '#6366f1' }} /> {/* indigo-500 */}
        <stop offset="100%" style={{ stopColor: '#a855f7' }} /> {/* purple-500 */}
      </linearGradient>
    </defs>

    {/* Logomark - Abstract Car/Post Icon */}
    <g transform="translate(8, 0)">
      {/* Main Shape */}
      <path 
        d="M24 0 L56 20 L24 40 L-8 20 Z M8 20 L24 10 L40 20 L24 30 Z"
        fill="url(#logoGradient)"
      />
      {/* AI Sparkle / Highlight */}
      <path
        d="M21.33 10 L24 15 L26.67 10 L30.67 8 L26.67 6 L24 1 L21.33 6 Z"
        fill="#ffffff"
      />
    </g>

    {/* Wordmark */}
    <g transform="translate(74, 0)">
      <text 
        x="0" 
        y="16" 
        fontFamily="Poppins, sans-serif" 
        fontSize="14" 
        fontWeight="600" 
        fill="#e2e8f0"
      >
        DEALER SOCIAL
      </text>
      <text 
        x="0" 
        y="34" 
        fontFamily="Poppins, sans-serif" 
        fontSize="18" 
        fontWeight="800"
        fill="#ffffff"
      >
        POST 
        <tspan fill="url(#logoGradient)">AI</tspan>
      </text>
    </g>
  </svg>
);
