import React, { useEffect, useMemo, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { Sparkles, Shuffle, Star, Search, Clock3 } from "lucide-react";
import { triggerHapticFeedback } from "../utils/haptics";
import {
  featuredFunStyleCatalog,
  funStyleCatalog,
  funStyleCategories,
} from "../services/promptConfig";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

interface FunModeDirectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStyle: (styleName: string) => void;
  /** Comma/newline-separated fun style ids; empty = all styles available. */
  enabledFunStyles?: string;
}

const parseEnabledFunStyles = (raw?: string): Set<string> | null => {
  if (!raw?.trim()) return null;
  const ids = raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
};

export const FunModeDirectorModal: React.FC<FunModeDirectorModalProps> = ({
  isOpen,
  onClose,
  onSelectStyle,
  enabledFunStyles,
}) => {
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  /** Default to top popular styles only — full library behind "All styles". */
  const [category, setCategory] = useState<string>("Top picks");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [showFullLibrary, setShowFullLibrary] = useState(false);

  const handleStyleSelect = (styleId: string) => {
    setSelectedStyle(styleId);
    setRecent((prev) => {
      const next = [styleId, ...prev.filter((id) => id !== styleId)].slice(0, 6);
      localStorage.setItem("fun-mode-recent", JSON.stringify(next));
      return next;
    });
    triggerHapticFeedback();
  };

  useEffect(() => {
    try {
      const savedFavorites = localStorage.getItem("fun-mode-favorites");
      if (savedFavorites) setFavorites(JSON.parse(savedFavorites));
      const savedRecent = localStorage.getItem("fun-mode-recent");
      if (savedRecent) setRecent(JSON.parse(savedRecent));
    } catch {
      // ignore parse errors
    }
  }, [isOpen]);

  useEffect(() => {
    try {
      localStorage.setItem("fun-mode-favorites", JSON.stringify(favorites));
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

  const allowedIds = useMemo(
    () => parseEnabledFunStyles(enabledFunStyles),
    [enabledFunStyles],
  );

  const catalog = useMemo(() => {
    const base = showFullLibrary ? funStyleCatalog : featuredFunStyleCatalog;
    if (!allowedIds) return base;
    const filtered = base.filter((s) => allowedIds.has(s.id));
    // Fall back if dealer config ids don't match any style in the active set
    if (filtered.length > 0) return filtered;
    if (!showFullLibrary) {
      const fullFiltered = funStyleCatalog.filter((s) => allowedIds.has(s.id));
      return fullFiltered.length > 0 ? fullFiltered : featuredFunStyleCatalog;
    }
    return funStyleCatalog;
  }, [allowedIds, showFullLibrary]);

  const filteredStyles = useMemo(() => {
    return catalog.filter((style) => {
      const matchesCategory =
        category === "All" || category === "Top picks"
          ? true
          : category === "Favorites"
            ? favorites.includes(style.id)
            : category === "Popular"
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
  }, [catalog, category, searchQuery, favorites]);

  const handleConfirm = () => {
    if (selectedStyle) {
      onSelectStyle(selectedStyle);
      setSelectedStyle(null);
    }
  };

  const handleSurpriseMe = () => {
    const pool = filteredStyles.length ? filteredStyles : catalog;
    const choice = pool[Math.floor(Math.random() * pool.length)];
    triggerHapticFeedback();
    onSelectStyle(choice.id);
    setSelectedStyle(choice.id);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title="Fun mode"
      description="Top styles only — bold campaign looks that still keep your real car and customers."
      className="bg-gradient-to-br from-surface-900 to-surface-800 p-0 overflow-hidden border-hairline"
      footer={
        <>
          <Button
            variant="tinted"
            onClick={handleSurpriseMe}
            className="flex-1"
            leftIcon={<Shuffle className="w-4 h-4" />}
          >
            Surprise Me!
          </Button>

          <Button
            variant="filled"
            onClick={handleConfirm}
            disabled={!selectedStyle}
            className="flex-1"
            leftIcon={<Sparkles className="w-4 h-4" />}
          >
            Generate style
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-white/60">
          Showing {catalog.length} {showFullLibrary ? "styles" : "top picks"}
        </p>
        <button
          type="button"
          onClick={() => {
            triggerHapticFeedback();
            setShowFullLibrary((v) => !v);
            setCategory(showFullLibrary ? "Top picks" : "All");
          }}
          className="text-xs font-semibold text-primary-300 hover:text-primary-200 underline-offset-2 hover:underline"
        >
          {showFullLibrary ? "Show top picks only" : "Show all styles"}
        </button>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-6">
        <div className="flex flex-wrap gap-2">
          {(showFullLibrary
            ? ["All", "Popular", "Favorites", ...funStyleCategories]
            : ["Top picks", "Favorites"]
          ).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                category === cat
                  ? "border-primary-400 bg-primary-500/20 text-white"
                  : "border-strong text-white/70 hover:border-primary-300/60 hover:bg-fill-subtle"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="relative w-full lg:w-80">
          <Search className="w-4 h-4 text-white/60 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            aria-label="Search fun styles"
            className="w-full bg-fill-subtle border border-hairline rounded-xl pl-10 pr-3 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
            placeholder="Search styles or keywords"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Recent Styles */}
      {recent.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-white/70 mb-4">
          <Clock3 className="w-4 h-4" />
          <span>Recent:</span>
          <div className="flex gap-1 flex-wrap">
            {recent.map((id) => {
              const style = catalog.find((s) => s.id === id);
              if (!style) return null;
              return (
                <button
                  key={id}
                  onClick={() => handleStyleSelect(id)}
                  className={`px-2 py-1 rounded-full border text-[11px] transition-all ${
                    selectedStyle === id
                      ? "border-primary-400 text-white bg-primary-500/10"
                      : "border-strong text-white/70 hover:border-primary-300 hover:text-white"
                  }`}
                >
                  {style.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Style Grid / List */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pb-2">
        {filteredStyles.map((style) => {
          const promptPreview = style.prompt.split(". ")[0];
          const isFavorite = favorites.includes(style.id);
          return (
            <m.div
              key={style.id}
              className={`relative px-3 py-2.5 rounded-lg border transition-all text-left group ${
                selectedStyle === style.id
                  ? "border-primary-400 bg-primary-500/20"
                  : "border-hairline bg-fill-subtle hover:border-strong hover:bg-fill-hover"
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <button
                type="button"
                onClick={() => handleStyleSelect(style.id)}
                className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900"
                aria-label={`Use ${style.name} style`}
                aria-pressed={selectedStyle === style.id}
              />
              <div className="pointer-events-none relative flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-white font-medium text-sm group-hover:text-primary-300 transition-colors">
                    {style.name}
                  </h3>
                  <p className="text-[10px] text-white/50 border border-hairline rounded-full px-1.5 py-0.5">
                    {style.category}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {style.popular && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-200 border border-amber-400/40 uppercase tracking-wide font-bold">
                      Hot
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(style.id);
                    }}
                    className={`pointer-events-auto relative z-10 p-1 rounded-full border transition-all ${
                      isFavorite
                        ? "border-yellow-300/70 bg-yellow-400/10 text-yellow-200"
                        : "border-strong text-white/60 hover:border-yellow-200/60 hover:text-yellow-200"
                    }`}
                    aria-label={`${isFavorite ? "Remove" : "Add"} ${style.name} ${isFavorite ? "from" : "to"} favorites`}
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${isFavorite ? "fill-current" : ""}`}
                    />
                  </button>
                </div>
              </div>
              <p className="pointer-events-none relative text-white/60 text-[11px] leading-tight truncate">
                {promptPreview}
              </p>
            </m.div>
          );
        })}
        {filteredStyles.length === 0 && (
          <div className="col-span-full text-center text-sm text-white/60 py-12 flex flex-col items-center gap-3">
            <Search className="w-8 h-8 opacity-50" />
            <p>No styles found. Try another search or category.</p>
          </div>
        )}
      </div>
    </Modal>
  );
};
