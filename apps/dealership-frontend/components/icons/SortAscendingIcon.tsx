import React from 'react';

const SortAscendingIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M3 12h4" />
    <path d="M3 6h10" />
    <path d="M3 18h6" />
    <path d="m21 18-4-4-4 4" />
    <path d="M17 6v12" />
  </svg>
);

export default SortAscendingIcon;