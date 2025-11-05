import React from 'react';
import { Icon } from './Icons';

interface DialpadProps {
  onKeyPress: (key: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '0' | 'backspace' | 'clear') => void;
}

const DialpadButton: React.FC<{
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}> = ({ onClick, children, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center justify-center p-4 rounded-full aspect-square bg-white/5 hover:bg-white/20 active:bg-white/30 transition-all duration-200 transform active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${className}`}
  >
    {children}
  </button>
);

export const Dialpad: React.FC<DialpadProps> = ({ onKeyPress }) => {
  const buttons = [
    '1', '2', '3',
    '4', '5', '6',
    '7', '8', '9',
  ];

  return (
    <div className="grid grid-cols-3 gap-4 text-white font-bold text-2xl">
      {buttons.map((num) => (
        <DialpadButton key={num} onClick={() => onKeyPress(num as any)}>
          {num}
        </DialpadButton>
      ))}
      <div className="opacity-0"></div> {/* Spacer */}
      <DialpadButton onClick={() => onKeyPress('0')}>
        0
      </DialpadButton>
      <DialpadButton onClick={() => onKeyPress('backspace')}>
        <Icon type="backspace" className="w-7 h-7" />
      </DialpadButton>
    </div>
  );
};