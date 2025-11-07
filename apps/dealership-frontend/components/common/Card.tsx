import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

const Card: React.FC<CardProps> = ({ children, className = '', onClick }) => {
  return (
    <div
      onClick={onClick}
      className={`
        bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-2xl 
        shadow-xl transition-all duration-300
        ${onClick ? 'cursor-pointer hover:bg-gray-700/50 hover:border-gray-600' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
};

export default Card;
