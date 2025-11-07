import React from 'react';

const DemonstrationIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
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
    <path d="M14 16.5 17.5 13 21 16.5" />
    <path d="M17.5 20v-7" />
    <path d="M19 22H5" />
    <path d="m5 18-3-3 3-3" />
    <path d="M2 15h12" />
    <path d="M7 12V2h10v10" />
    <path d="M11 12V8" />
  </svg>
);

export default DemonstrationIcon;
