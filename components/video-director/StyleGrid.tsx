import React from 'react';
import { motion } from 'framer-motion';
import { VideoStyle } from '../../types';
import { Icon, IconProps } from '../Icons';
import { triggerHapticFeedback } from '../../utils/haptics';
import { styles } from './constants';

interface StyleCardProps {
  style: VideoStyle;
  icon: IconProps['type'];
  description: string;
  onSelect: (style: VideoStyle) => void;
}

const StyleCard: React.FC<StyleCardProps> = React.memo(({ style, icon, description, onSelect }) => {
  const handleClick = () => {
    triggerHapticFeedback();
    onSelect(style);
  };

  return (
    <motion.button
      onClick={handleClick}
      className="group flex flex-col items-center justify-center text-center p-3 bg-white/5 border border-white/10 rounded-xl aspect-square transition-all duration-200 hover:bg-indigo-500/20 hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      title={description}
      aria-label={`${style}: ${description}`}
      whileHover={{ scale: 1.05, y: -2 }}
      whileTap={{ scale: 0.97 }}
    >
      <Icon type={icon} className="w-8 h-8 sm:w-10 sm:h-10 text-indigo-400 transition-colors duration-200 group-hover:text-indigo-300" />
      <h3 className="mt-2 font-semibold text-white text-xs text-center break-words leading-tight">{style}</h3>
      <p className="mt-1 text-[11px] text-indigo-100/80 line-clamp-2">{description}</p>
    </motion.button>
  );
});

interface StyleGridProps {
  onSelect: (style: VideoStyle) => void;
}

export const StyleGrid: React.FC<StyleGridProps> = ({ onSelect }) => {
  return (
    <div className="overflow-y-auto max-h-[50vh] pr-2 -mr-2 custom-scrollbar">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {styles.map(({ style, icon, description }) => (
          <StyleCard key={style} style={style} icon={icon} description={description} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
};
