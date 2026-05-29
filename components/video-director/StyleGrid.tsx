import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { VideoStyle } from '../../types';
import { Icon, IconProps } from '../Icons';
import { triggerHapticFeedback } from '../../utils/haptics';
import { styles, styleCategories } from './constants';

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
      className="group flex flex-col items-center justify-center text-center p-3 bg-white/5 border border-white/10 rounded-xl aspect-square transition-all duration-200 hover:bg-indigo-500/20 hover:border-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
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
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [showRecommended, setShowRecommended] = useState<boolean>(false);

  const filteredStyles = useMemo(() => {
    return styles.filter(({ style, description, category: cat, recommended }) => {
      const matchesCategory = category === 'All' || cat === category;
      const matchesQuery =
        !query ||
        style.toLowerCase().includes(query.toLowerCase()) ||
        description.toLowerCase().includes(query.toLowerCase());
      const matchesRec = !showRecommended || recommended;
      return matchesCategory && matchesQuery && matchesRec;
    });
  }, [category, query, showRecommended]);

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 flex-wrap">
          {['All', ...styleCategories].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                category === cat
                  ? 'border-primary-400 bg-primary-500/20 text-white'
                  : 'border-white/15 text-white/70 hover:border-primary-300/60'
              }`}
            >
              {cat}
            </button>
          ))}
          <button
            onClick={() => setShowRecommended((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              showRecommended
                ? 'border-emerald-400 bg-emerald-500/20 text-white'
                : 'border-white/15 text-white/70 hover:border-emerald-300/60'
            }`}
          >
            Recommended
          </button>
        </div>
        <div className="w-full sm:w-64">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search styles..."
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          />
        </div>
      </div>

      <div className="overflow-y-auto max-h-[50vh] pr-2 -mr-2 custom-scrollbar">
        {filteredStyles.length === 0 ? (
          <div className="text-sm text-white/60 py-8 text-center">No styles match that search.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredStyles.map(({ style, icon, description, recommended, category: cat }) => (
              <div key={style} className="relative">
                {recommended && (
                  <span className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-400/40">
                    Recommended
                  </span>
                )}
                <StyleCard style={style} icon={icon} description={`${cat} · ${description}`} onSelect={onSelect} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
