import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronsUpDown, Loader2, Search, User } from "lucide-react";
import {
  Salesperson,
  listSalespeople,
} from "../services/salespeople";
import { Input } from "./ui/Input";
import { cn } from "../utils/classNames";

interface SalespersonPickerProps {
  /** The currently selected salesperson_id (preferred) OR free-form name. */
  value: { id?: string; name: string };
  onChange: (next: { id?: string; name: string }) => void;
  className?: string;
}

const STORAGE_KEY = "dsp.salespersonPicker";

/**
 * Searchable salesperson dropdown. Falls back to a free-text input when the
 * dealer's roster is empty (legacy behaviour). Persists last selection in
 * localStorage so the same iPad keeps the same identity across sessions.
 */
export const SalespersonPicker: React.FC<SalespersonPickerProps> = ({
  value,
  onChange,
  className,
}) => {
  const [roster, setRoster] = useState<Salesperson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Load roster on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await listSalespeople(false);
        if (!cancelled) setRoster(items);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore the last selection on mount when nothing's already chosen
  useEffect(() => {
    if (value.id || value.name) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { id?: string; name: string };
      if (parsed?.name) onChange(parsed);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist
  useEffect(() => {
    try {
      if (value.name)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.pin || "").toLowerCase().includes(q)
    );
  }, [roster, query]);

  const handlePick = useCallback(
    (s: Salesperson | { id?: undefined; name: string }) => {
      onChange({ id: (s as Salesperson).id, name: s.name });
      setOpen(false);
      setQuery("");
    },
    [onChange]
  );

  // Empty roster → fall back to a plain text input. Don't make the GSM
  // configure a roster before they can post.
  if (!loading && roster.length === 0 && !error) {
    return (
      <Input
        label="Your name (salesperson — counts toward leaderboard)"
        value={value.name}
        onChange={(e) => onChange({ id: undefined, name: e.target.value })}
        placeholder="e.g. Joe G."
        fullWidth
        className={cn(
          "bg-white/5 border-white/10 focus:border-primary-400 focus:bg-white/10 transition-colors",
          className
        )}
      />
    );
  }

  const displayLabel = value.name || "Pick yourself";

  return (
    <div ref={containerRef} className={cn("space-y-1.5", className)}>
      <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
        Your name (counts toward leaderboard)
      </label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl",
          "bg-white/5 border border-white/10 hover:bg-white/10 transition-colors",
          "text-left text-sm"
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          <User className="h-4 w-4 text-primary-300 flex-shrink-0" />
          <span
            className={cn(
              "truncate",
              value.name ? "text-surface-50" : "text-surface-400"
            )}
          >
            {displayLabel}
          </span>
          {value.id && (
            <span className="text-[10px] uppercase tracking-wide text-success-300 font-semibold ml-1">
              · in roster
            </span>
          )}
        </span>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-surface-400" />
        ) : (
          <ChevronsUpDown className="h-4 w-4 text-surface-400" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="rounded-xl border border-white/10 bg-surface-900/95 backdrop-blur-xl shadow-2xl p-2 space-y-1 max-h-72 overflow-y-auto"
          >
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search teammates…"
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-2 py-1.5 text-xs text-surface-100 focus:border-primary-400 focus:outline-none"
                autoFocus
              />
            </div>

            {filtered.length === 0 ? (
              <div className="text-[11px] text-surface-500 px-2 py-3 text-center">
                No matches. Type your name below to post unrostered.
              </div>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((s) => {
                  const active = value.id === s.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => handlePick(s)}
                        className={cn(
                          "w-full flex items-center justify-between px-2 py-2 rounded-lg text-sm transition-colors",
                          active
                            ? "bg-primary-500/20 text-primary-100"
                            : "hover:bg-white/5 text-surface-100"
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{s.name}</span>
                          {s.pin && (
                            <span className="text-[10px] font-mono text-surface-400">
                              PIN {s.pin}
                            </span>
                          )}
                        </span>
                        {active && <Check className="h-3.5 w-3.5 text-primary-300" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* "Unlisted" escape hatch — let an unrostered salesperson still post */}
            <div className="border-t border-white/5 pt-2">
              <Input
                label=""
                value={value.id ? "" : value.name}
                onChange={(e) =>
                  onChange({ id: undefined, name: e.target.value })
                }
                placeholder="Or type your name (unlisted)"
                fullWidth
                className="bg-white/5 border-white/10 focus:border-primary-400 text-sm"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="text-[11px] text-error-300">
          Could not load roster: {error}
        </div>
      )}
    </div>
  );
};
