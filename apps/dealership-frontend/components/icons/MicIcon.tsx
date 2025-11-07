
import React from 'react';

const MicIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    {...props}
  >
    <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1h2v1a5 5 0 0 0 10 0v-1z" />
    <path d="M12 19a4 4 0 0 1-4-4h-2a6 6 0 0 0 6 6v3h2v-3a6 6 0 0 0 6-6h-2a4 4 0 0 1-4 4z" />
  </svg>
);

export default MicIcon;
