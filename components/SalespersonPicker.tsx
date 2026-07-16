import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronsUpDown, Loader2, Search, User } from "lucide-react";
import { Salesperson, listSalespeople } from "../services/salespeople";
import { Input } from "./ui/Input";
import { cn } from "../utils/classNames";

interface SalespersonPickerProps {
  /** Dealer scope for persisted identity on shared showroom devices. */
  dealerId: string;
  /** The currently selected salesperson_id (preferred) OR free-form name. */
  value: { id?: string; name: string };
  onChange: (next: { id?: string; name: string }) => void;
  className?: string;
}

const LEGACY_PICKER_STORAGE_KEY = "dsp.salespersonPicker";
const LEGACY_NAME_STORAGE_KEY = "dsp.salespersonName";

export const salespersonStorageKey = (dealerId: string): string =>
  `dsp.salespersonPicker.${dealerId}`;

type PersistedSalesperson = { id?: string; name: string };

const parsePersistedSalesperson = (
  raw: string | null,
): PersistedSalesperson | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSalesperson>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name) return null;
    return {
      ...(typeof parsed.id === "string" && parsed.id.trim()
        ? { id: parsed.id.trim() }
        : {}),
      name,
    };
  } catch {
    return null;
  }
};

const canonicalRosterMatch = (
  candidate: PersistedSalesperson,
  roster: Salesperson[],
): PersistedSalesperson | null => {
  if (candidate.id) {
    const match = roster.find((person) => person.id === candidate.id);
    return match ? { id: match.id, name: match.name } : null;
  }

  const normalizedName = candidate.name.trim().toLocaleLowerCase();
  const matches = roster.filter(
    (person) => person.name.trim().toLocaleLowerCase() === normalizedName,
  );
  return matches.length === 1
    ? { id: matches[0].id, name: matches[0].name }
    : null;
};

/**
 * Searchable salesperson dropdown. Falls back to a free-text input when the
 * dealer's roster is empty (legacy behaviour). Persists last selection in
 * localStorage so the same iPad keeps the same identity across sessions.
 */
export const SalespersonPicker: React.FC<SalespersonPickerProps> = ({
  dealerId,
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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mountedRef = useRef(true);
  const restoredDealerRef = useRef<string | null>(null);
  const activeDealerRef = useRef(dealerId);
  const rosterDealerRef = useRef<string | null>(null);
  const labelId = useId();
  const triggerId = useId();
  const listboxId = useId();

  const loadRoster = useCallback(async () => {
    const requestedDealerId = dealerId;
    rosterDealerRef.current = null;
    setRoster([]);
    setLoading(true);
    setError(null);
    try {
      const items = await listSalespeople(false);
      if (mountedRef.current && activeDealerRef.current === requestedDealerId) {
        rosterDealerRef.current = requestedDealerId;
        setRoster(items);
      }
    } catch (err) {
      if (mountedRef.current && activeDealerRef.current === requestedDealerId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current && activeDealerRef.current === requestedDealerId) {
        setLoading(false);
      }
    }
  }, [dealerId]);

  // Load roster on mount
  useEffect(() => {
    mountedRef.current = true;
    void loadRoster();
    return () => {
      mountedRef.current = false;
    };
  }, [loadRoster]);

  useEffect(() => {
    if (activeDealerRef.current === dealerId) return;
    activeDealerRef.current = dealerId;
    restoredDealerRef.current = null;
    setOpen(false);
    setQuery("");
    if (value.id || value.name) onChange({ name: "" });
  }, [dealerId, onChange, value.id, value.name]);

  // Restore only after the active dealer's server-scoped roster is known. The
  // old global keys are migrated solely when they match this roster, preventing
  // another dealership's salesperson from leaking onto a shared iPad.
  useEffect(() => {
    if (loading || error || !dealerId) return;
    if (rosterDealerRef.current !== dealerId) return;
    if (restoredDealerRef.current === dealerId) return;
    restoredDealerRef.current = dealerId;

    try {
      const scopedKey = salespersonStorageKey(dealerId);
      const scoped = parsePersistedSalesperson(localStorage.getItem(scopedKey));
      if (scoped) {
        const canonical = scoped.id
          ? canonicalRosterMatch(scoped, roster)
          : (canonicalRosterMatch(scoped, roster) ?? scoped);
        if (canonical) {
          onChange(canonical);
          return;
        }
        localStorage.removeItem(scopedKey);
      }

      const legacyPicker = parsePersistedSalesperson(
        localStorage.getItem(LEGACY_PICKER_STORAGE_KEY),
      );
      const legacyName = localStorage.getItem(LEGACY_NAME_STORAGE_KEY)?.trim();
      const legacyCandidate =
        legacyPicker ?? (legacyName ? { name: legacyName } : null);
      if (!legacyCandidate) return;

      const canonical = canonicalRosterMatch(legacyCandidate, roster);
      if (!canonical) return;

      localStorage.setItem(scopedKey, JSON.stringify(canonical));
      localStorage.removeItem(LEGACY_PICKER_STORAGE_KEY);
      localStorage.removeItem(LEGACY_NAME_STORAGE_KEY);
      onChange(canonical);
    } catch {
      /* ignore */
    }
  }, [dealerId, error, loading, onChange, roster]);

  // Persist only within this dealer after the restore/migration pass completes.
  useEffect(() => {
    if (restoredDealerRef.current !== dealerId || !dealerId) return;
    try {
      const scopedKey = salespersonStorageKey(dealerId);
      if (value.name.trim()) {
        localStorage.setItem(
          scopedKey,
          JSON.stringify({ ...value, name: value.name.trim() }),
        );
      } else {
        localStorage.removeItem(scopedKey);
      }
    } catch {
      /* ignore */
    }
  }, [dealerId, value]);

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
        (s.pin || "").toLowerCase().includes(q),
    );
  }, [roster, query]);

  const handlePick = useCallback(
    (s: Salesperson | { id?: undefined; name: string }) => {
      onChange({ id: (s as Salesperson).id, name: s.name });
      setOpen(false);
      setQuery("");
      requestAnimationFrame(() => triggerRef.current?.focus());
    },
    [onChange],
  );

  const focusOption = (index: number) => {
    const count = filtered.length;
    if (!count) return;
    const normalized = (index + count) % count;
    optionRefs.current[normalized]?.focus();
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      requestAnimationFrame(() =>
        focusOption(event.key === "ArrowDown" ? 0 : filtered.length - 1),
      );
    }
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(filtered.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

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
          className,
        )}
      />
    );
  }

  const displayLabel = value.name || "Pick yourself";

  return (
    <div ref={containerRef} className={cn("space-y-1.5", className)}>
      <label
        id={labelId}
        htmlFor={triggerId}
        className="text-xs font-medium text-surface-300 uppercase tracking-wide"
      >
        Your name (counts toward leaderboard)
      </label>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open && filtered.length ? listboxId : undefined}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl",
          "bg-white/5 border border-white/10 hover:bg-white/10 transition-colors",
          "text-left text-sm",
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          <User className="h-4 w-4 text-primary-300 flex-shrink-0" />
          <span
            className={cn(
              "truncate",
              value.name ? "text-surface-50" : "text-surface-400",
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
                aria-label="Search dealership teammates"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
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
              <ul
                id={listboxId}
                role="listbox"
                aria-labelledby={labelId}
                className="space-y-0.5"
              >
                {filtered.map((s, index) => {
                  const active = value.id === s.id;
                  return (
                    <li key={s.id} role="none">
                      <button
                        ref={(element) => {
                          optionRefs.current[index] = element;
                        }}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => handlePick(s)}
                        onKeyDown={(event) => handleOptionKeyDown(event, index)}
                        className={cn(
                          "w-full flex items-center justify-between px-2 py-2 rounded-lg text-sm transition-colors",
                          active
                            ? "bg-primary-500/20 text-primary-100"
                            : "hover:bg-white/5 text-surface-100",
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
                        {active && (
                          <Check className="h-3.5 w-3.5 text-primary-300" />
                        )}
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
                aria-label="Unlisted salesperson name"
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
        <div
          className="flex items-start justify-between gap-3 rounded-lg border border-error-500/25 bg-error-500/10 px-3 py-2 text-xs text-error-200"
          role="alert"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadRoster()}
            className="shrink-0 font-semibold text-error-100 underline underline-offset-2 hover:text-white"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
};
