import React from 'react';

const AlertIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    {...props}
  >
    <path
      fillRule="evenodd"
      d="M12 2.25c-5.122 0-9.25 3.93-9.25 8.75 0 2.24.833 4.331 2.25 5.968V19.5a.75.75 0 00.75.75h12.5a.75.75 0 00.75-.75v-2.532c1.417-1.637 2.25-3.728 2.25-5.968 0-4.82-4.128-8.75-9.25-8.75zM10.5 21a1.5 1.5 0 003 0h-3z"
      clipRule="evenodd"
    />
  </svg>
);

export default AlertIcon;
