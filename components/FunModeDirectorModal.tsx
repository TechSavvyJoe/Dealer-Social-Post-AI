import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Shuffle, X } from 'lucide-react';
import { triggerHapticFeedback } from '../utils/haptics';

interface FunModeDirectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectStyle: (styleName: string) => void;
}

// Popular fun styles for user selection
const FEATURED_FUN_STYLES = [
    {
        id: 'lego',
        name: 'LEGO Brick Creation',
        description: 'Transform into a LEGO masterpiece with minifigures',
        emoji: '🧱',
        gradient: 'from-yellow-500 to-red-500'
    },
    {
        id: 'superhero',
        name: 'Superhero Comic Book',
        description: 'Classic comic book style with bold lines and halftone dots',
        emoji: '💥',
        gradient: 'from-blue-500 to-purple-600'
    },
    {
        id: 'anime',
        name: 'Japanese Anime',
        description: 'Vibrant anime scene with expressive characters',
        emoji: '⚡',
        gradient: 'from-pink-500 to-violet-600'
    },
    {
        id: 'pixar',
        name: '3D Animated Movie',
        description: 'Pixar-style 3D animation with warm, magical lighting',
        emoji: '✨',
        gradient: 'from-cyan-500 to-blue-600'
    },
    {
        id: 'gta',
        name: 'Grand Theft Auto',
        description: 'Iconic GTA loading screen art style',
        emoji: '🎮',
        gradient: 'from-orange-500 to-red-600'
    },
    {
        id: 'popart',
        name: 'Pop Art (Warhol)',
        description: 'Bold colors and screen-printed texture',
        emoji: '🎨',
        gradient: 'from-fuchsia-500 to-pink-600'
    },
    {
        id: 'claymation',
        name: 'Claymation Stop-Motion',
        description: 'Tangible clay texture with finger-printed details',
        emoji: '🎬',
        gradient: 'from-amber-500 to-orange-600'
    },
    {
        id: 'vintage',
        name: 'Vintage 1930s Cartoon',
        description: 'Rubber hose animation style in black and white',
        emoji: '📽️',
        gradient: 'from-gray-500 to-gray-700'
    },
    {
        id: 'cyberpunk',
        name: 'Cyberpunk Neon Noir',
        description: 'Futuristic cityscape with neon lights and rain',
        emoji: '🌃',
        gradient: 'from-purple-600 to-cyan-500'
    },
    {
        id: 'impressionist',
        name: 'Impressionist Painting',
        description: 'Monet-style oil painting with visible brushstrokes',
        emoji: '🖼️',
        gradient: 'from-green-500 to-blue-500'
    },
    {
        id: 'graffiti',
        name: 'Street Art Graffiti',
        description: 'Vibrant mural with spray paint textures',
        emoji: '🎪',
        gradient: 'from-rose-500 to-orange-500'
    },
    {
        id: '8bit',
        name: '8-Bit Pixel Art',
        description: 'Classic Nintendo-style pixelated graphics',
        emoji: '👾',
        gradient: 'from-indigo-500 to-purple-600'
    }
];

export const FunModeDirectorModal: React.FC<FunModeDirectorModalProps> = ({
    isOpen,
    onClose,
    onSelectStyle,
}) => {
    const [selectedStyle, setSelectedStyle] = useState<string | null>(null);

    // Randomize which styles to show each time
    const displayedStyles = useMemo(() => {
        const shuffled = [...FEATURED_FUN_STYLES].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, 9); // Show 9 random styles in a 3x3 grid
    }, [isOpen]);

    const handleStyleSelect = (styleId: string) => {
        setSelectedStyle(styleId);
        triggerHapticFeedback();
    };

    const handleConfirm = () => {
        if (selectedStyle) {
            onSelectStyle(selectedStyle);
            setSelectedStyle(null);
        }
    };

    const handleSurpriseMe = () => {
        onSelectStyle('random');
        setSelectedStyle(null);
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <motion.div
                className="w-full max-w-4xl bg-gradient-to-br from-surface-900 to-surface-800 rounded-2xl shadow-2xl border border-white/10 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
            >
                {/* Header */}
                <div className="px-6 py-5 border-b border-white/10 bg-gradient-to-r from-purple-600/20 to-pink-600/20">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl">
                                <Sparkles className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold text-white">Fun Mode Director</h2>
                                <p className="text-sm text-white/70">Transform your photo into amazing art styles!</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-white/60 hover:text-white transition-colors p-2"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </div>
                </div>

                {/* Style Grid */}
                <div className="p-6 max-h-[60vh] overflow-y-auto">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {displayedStyles.map((style) => (
                            <motion.button
                                key={style.id}
                                onClick={() => handleStyleSelect(style.id)}
                                className={`p-4 rounded-xl border-2 transition-all text-left ${selectedStyle === style.id
                                    ? 'border-primary-400 bg-primary-500/20 scale-[1.02]'
                                    : 'border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10'
                                    }`}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                            >
                                <div className={`text-4xl mb-2 bg-gradient-to-br ${style.gradient} bg-clip-text text-transparent font-bold`}>
                                    {style.emoji}
                                </div>
                                <h3 className="text-white font-semibold text-sm mb-1">
                                    {style.name}
                                </h3>
                                <p className="text-white/60 text-xs leading-relaxed">
                                    {style.description}
                                </p>
                            </motion.button>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-white/10 bg-surface-900/50 flex gap-3">
                    <motion.button
                        onClick={handleSurpriseMe}
                        className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:shadow-glow-primary transition-all"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                    >
                        <Shuffle className="w-5 h-5" />
                        <span>Surprise Me!</span>
                    </motion.button>

                    <motion.button
                        onClick={handleConfirm}
                        disabled={!selectedStyle}
                        className={`flex-1 flex items-center justify-center gap-2 font-bold py-3 px-6 rounded-xl shadow-lg transition-all ${selectedStyle
                            ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:shadow-glow-primary'
                            : 'bg-white/10 text-white/40 cursor-not-allowed'
                            }`}
                        whileHover={selectedStyle ? { scale: 1.02 } : {}}
                        whileTap={selectedStyle ? { scale: 0.98 } : {}}
                    >
                        <Sparkles className="w-5 h-5" />
                        <span>Generate Selected Style</span>
                    </motion.button>
                </div>
            </motion.div>
        </div>
    );
};
