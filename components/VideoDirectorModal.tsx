import React from 'react';
import { VideoStyle } from '../types';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';

interface VideoDirectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStyle: (style: VideoStyle) => void;
}

interface StyleCardProps {
  style: VideoStyle;
  icon: 'starburst' | 'confetti' | 'film' | 'zap' | 'shooting-star';
  description: string;
  onSelect: (style: VideoStyle) => void;
}

const styles: { style: VideoStyle; icon: StyleCardProps['icon']; description: string }[] = [
  { style: VideoStyle.EpicReveal, icon: 'starburst', description: 'A cinematic, slow zoom with dramatic lens flares.' },
  { style: VideoStyle.PartyTime, icon: 'confetti', description: 'A vibrant celebration with falling confetti and streamers.' },
  { style: VideoStyle.VintageFilm, icon: 'film', description: 'A retro 8mm look with film grain and light leaks.' },
  { style: VideoStyle.NeonPulse, icon: 'zap', description: 'A futuristic, high-tech animation with glowing neon lines.' },
  { style: VideoStyle.CometStrike, icon: 'shooting-star', description: 'A magical reveal with a sparkling streak of light.' },
];

const StyleCard: React.FC<StyleCardProps> = ({ style, icon, description, onSelect }) => {
  const handleClick = () => {
    triggerHapticFeedback();
    onSelect(style);
  };

  return (
    <button
      onClick={handleClick}
      className="group flex flex-col items-center justify-center text-center p-4 bg-white/5 border-2 border-white/10 rounded-2xl aspect-square transition-all duration-300 hover:bg-white/10 hover:border-indigo-400 hover:scale-105 focus:outline-none focus:ring-4 focus:ring-indigo-500/50"
    >
      <Icon type={icon} className="w-10 h-10 sm:w-12 sm:h-12 text-indigo-400 group-hover:text-indigo-300 transition-colors duration-300" />
      <h3 className="mt-3 font-bold text-white text-sm sm:text-base">{style}</h3>
      <p className="mt-1 text-slate-400 text-xs sm:text-sm">{description}</p>
    </button>
  );
};

export const VideoDirectorModal: React.FC<VideoDirectorModalProps> = ({ isOpen, onClose, onSelectStyle }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-lg flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-director-title"
    >
      <div
        className="w-full max-w-2xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 id="video-director-title" className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3">
            <Icon type="movie" className="w-8 h-8 text-indigo-400" />
            AI Video Director
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <Icon type="close" className="w-7 h-7" />
          </button>
        </div>

        <p className="text-center text-indigo-300 mb-6">Choose a style to bring your photo to life.</p>
        
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {styles.map(({ style, icon, description }) => (
            <StyleCard key={style} style={style} icon={icon} description={description} onSelect={onSelectStyle} />
          ))}
        </div>
      </div>
    </div>
  );
};
