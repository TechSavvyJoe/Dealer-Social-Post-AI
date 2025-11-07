import React from 'react';

const SortDescendingIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
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
    <path d="m21 6-4 4-4-4" />
    <path d="M17 18V6" />
  </svg>
);

export default SortDescendingIcon;