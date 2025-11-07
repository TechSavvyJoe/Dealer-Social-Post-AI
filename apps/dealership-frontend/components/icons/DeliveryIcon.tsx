import React from 'react';

const DeliveryIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
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
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
    <rect width="14" height="14" x="4" y="4" rx="2" />
  </svg>
);

export default DeliveryIcon;
