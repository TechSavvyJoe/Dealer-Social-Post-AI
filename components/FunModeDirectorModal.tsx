import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Shuffle, Star, X, Search, Clock3 } from 'lucide-react';
import { triggerHapticFeedback } from '../utils/haptics';
import { funStyleCatalog, funStyleCategories } from '../services/promptConfig';

interface FunModeDirectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectStyle: (styleName: string) => void;
}

export const FunModeDirectorModal: React.FC<FunModeDirectorModalProps> = ({
    isOpen,
    onClose,
    onSelectStyle,
}) => {
    const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [category, setCategory] = useState<string>('All');
    const [favorites, setFavorites] = useState<string[]>([]);
    const [recent, setRecent] = useState<string[]>([]);

    const handleStyleSelect = (styleId: string) => {
        setSelectedStyle(styleId);
        setRecent((prev) => {
            const next = [styleId, ...prev.filter((id) => id !== styleId)].slice(0, 6);
            localStorage.setItem('fun-mode-recent', JSON.stringify(next));
            return next;
        });
        triggerHapticFeedback();
    };

    useEffect(() => {
        try {
            const savedFavorites = localStorage.getItem('fun-mode-favorites');
            if (savedFavorites) setFavorites(JSON.parse(savedFavorites));
            const savedRecent = localStorage.getItem('fun-mode-recent');
            if (savedRecent) setRecent(JSON.parse(savedRecent));
        } catch {
            // ignore parse errors
        }
    }, [isOpen]);

    useEffect(() => {
        try {
            localStorage.setItem('fun-mode-favorites', JSON.stringify(favorites));
        } catch {
            // ignore storage errors
        }
    }, [favorites]);

    const toggleFavorite = (id: string) => {
        setFavorites((prev) => {
            const exists = prev.includes(id);
            return exists ? prev.filter((item) => item !== id) : [...prev, id];
        });
    };

    const filteredStyles = useMemo(() => {
        return funStyleCatalog.filter((style) => {
            const matchesCategory =
                category === 'All'
                    ? true
                    : category === 'Favorites'
                        ? favorites.includes(style.id)
                        : category === 'Popular'
                            ? !!style.popular
                            : style.category === category;
            const q = searchQuery.trim().toLowerCase();
            const matchesSearch =
                !q ||
                style.name.toLowerCase().includes(q) ||
                style.prompt.toLowerCase().includes(q) ||
                style.tags?.some((tag) => tag.toLowerCase().includes(q));
            return matchesCategory && matchesSearch;
        });
    }, [category, searchQuery, favorites]);

    const handleConfirm = () => {
        if (selectedStyle) {
            onSelectStyle(selectedStyle);
            setSelectedStyle(null);
        }
    };

    const handleSurpriseMe = () => {
        const pool = filteredStyles.length ? filteredStyles : funStyleCatalog;
        const choice = pool[Math.floor(Math.random() * pool.length)];
        triggerHapticFeedback();
        onSelectStyle(choice.id);
        setSelectedStyle(choice.id);
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
                <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                        <div className="flex flex-wrap gap-2">
                            {['All', 'Popular', 'Favorites', ...funStyleCategories].map((cat) => (
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
                        </div>
                        <div className="relative w-full lg:w-80">
                            <Search className="w-4 h-4 text-white/60 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                                className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-3 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-primary-400"
                                placeholder="Search styles or keywords"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    {recent.length > 0 && (
                        <div className="flex items-center gap-2 text-xs text-white/70">
                            <Clock3 className="w-4 h-4" />
                            <span>Recent:</span>
                            <div className="flex gap-1 flex-wrap">
                                {recent.map((id) => {
                                    const style = funStyleCatalog.find((s) => s.id === id);
                                    if (!style) return null;
                                    return (
                                        <button
                                            key={id}
                                            onClick={() => handleStyleSelect(id)}
                                            className={`px-2 py-1 rounded-full border text-[11px] ${
                                                selectedStyle === id ? 'border-primary-400 text-white' : 'border-white/20 text-white/70 hover:border-primary-300'
                                            }`}
                                        >
                                            {style.name}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredStyles.map((style) => {
                            const promptPreview = style.prompt.split('. ')[0];
                            const isFavorite = favorites.includes(style.id);
                            return (
                                <motion.button
                                    key={style.id}
                                    onClick={() => handleStyleSelect(style.id)}
                                    className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                                        selectedStyle === style.id
                                            ? 'border-primary-400 bg-primary-500/20 scale-[1.01]'
                                            : 'border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10'
                                    }`}
                                    whileHover={{ scale: 1.01 }}
                                    whileTap={{ scale: 0.98 }}
                                >
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div>
                                            <h3 className="text-white font-semibold text-sm mb-1">
                                                {style.name}
                                            </h3>
                                            <p className="text-[11px] text-white/60">{style.category}</p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {style.popular && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 border border-amber-400/40">
                                                    Staff Pick
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleFavorite(style.id);
                                                }}
                                                className={`p-1 rounded-full border ${
                                                    isFavorite ? 'border-yellow-300/70 bg-yellow-400/10 text-yellow-200' : 'border-white/20 text-white/60 hover:border-yellow-200/60'
                                                }`}
                                                aria-label="Toggle favorite"
                                            >
                                                <Star className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
                                            </button>
                                        </div>
                                    </div>
                                    <p className="text-white/70 text-xs leading-relaxed line-clamp-3">{promptPreview}</p>
                                </motion.button>
                            );
                        })}
                        {filteredStyles.length === 0 && (
                            <div className="col-span-full text-center text-sm text-white/60 py-6">
                                No styles found. Try another search or category.
                            </div>
                        )}
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
