import React from 'react';

const TranscriptIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
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
    <path d="M8 6h10" />
    <path d="M6 12h12" />
    <path d="M6 18h12" />
    <path d="M4 6.5h.01" />
    <path d="M4 12.5h.01" />
    <path d="M4 18.5h.01" />
  </svg>
);

export default TranscriptIcon;
