import React, { useId, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check, Sparkles } from "lucide-react";
import {
  POST_SCENARIOS,
  PostScenario,
  ScenarioCategory,
  SCENARIO_CATEGORY_LABELS,
  SCENARIO_CATEGORY_ICON,
  getScenariosForDealer,
} from "../services/postScenarios";
import { useAppStore } from "../stores/appStore";
import { cn } from "../utils/classNames";
import { triggerHapticFeedback } from "../utils/haptics";

interface ScenarioPickerProps {
  /** Currently selected scenario id, or undefined for "Customer Delivery" default. */
  value?: string;
  onChange: (scenario: PostScenario | undefined) => void;
  className?: string;
}

/**
 * Compact scenario picker. Sits at the top of the post customizer and tunes
 * the underlying prompt + default style/tone based on what kind of post the
 * salesperson is making (customer delivery vs pre-owned spotlight vs service
 * promo, etc.).
 *
 * Picking a scenario doesn't lock the salesperson in — they can still
 * override style/tone/caption afterward. The picker just gives them a smart
 * starting point.
 */
export const ScenarioPicker: React.FC<ScenarioPickerProps> = ({
  value,
  onChange,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const currentDealer = useAppStore((s) => s.currentDealer);

  // Built-in catalog + dealer-defined custom scenarios from their record.
  const allScenarios = useMemo(
    () => getScenariosForDealer(currentDealer?.custom_scenarios),
    [currentDealer?.custom_scenarios],
  );

  const grouped = useMemo(() => {
    const groups = new Map<ScenarioCategory, PostScenario[]>();
    for (const s of allScenarios) {
      const list = groups.get(s.category) || [];
      list.push(s);
      groups.set(s.category, list);
    }
    return Array.from(groups.entries());
  }, [allScenarios]);

  const current = value ? allScenarios.find((s) => s.id === value) : allScenarios[0]; // first scenario (Customer Delivery by convention)

  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
        Post type
      </label>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        onClick={() => {
          triggerHapticFeedback();
          setOpen((o) => !o);
        }}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl",
          "bg-white/5 border border-white/10 hover:bg-white/10 transition-colors",
          "text-left text-sm",
        )}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          {current &&
            (() => {
              const Icon = SCENARIO_CATEGORY_ICON[current.category];
              return (
                <span className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-primary-500/10 border border-primary-500/20">
                  <Icon className="w-5 h-5 text-primary-300" />
                </span>
              );
            })()}
          <span className="min-w-0">
            <span className="block text-surface-50 truncate font-semibold">
              {current?.label}
            </span>
            <span className="block text-[10px] text-surface-400 truncate">
              {current?.blurb}
            </span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-surface-400 flex-shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={listboxId}
            role="listbox"
            aria-label="Post type"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="rounded-xl border border-white/10 bg-surface-900/95 backdrop-blur-xl shadow-2xl p-2 max-h-96 overflow-y-auto"
          >
            {grouped.map(([category, list]) => (
              <div key={category} className="mb-2 last:mb-0">
                <div className="text-[10px] uppercase tracking-wide text-surface-500 px-2 pb-1 pt-1.5">
                  {SCENARIO_CATEGORY_LABELS[category]}
                </div>
                <ul className="space-y-0.5">
                  {list.map((s) => {
                    const active = (value || POST_SCENARIOS[0].id) === s.id;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => {
                            triggerHapticFeedback();
                            onChange(s);
                            setOpen(false);
                          }}
                          className={cn(
                            "w-full flex items-start gap-2 px-2 py-2 rounded-lg text-left transition-colors",
                            active
                              ? "bg-primary-500/20 text-primary-100"
                              : "hover:bg-white/5 text-surface-100",
                          )}
                        >
                          {(() => {
                            const Icon = SCENARIO_CATEGORY_ICON[s.category];
                            return (
                              <span
                                className={cn(
                                  "flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg mt-0.5 transition-colors",
                                  active
                                    ? "bg-primary-500/20 text-primary-200"
                                    : "bg-white/[0.06] text-surface-300",
                                )}
                              >
                                <Icon className="w-4 h-4" />
                              </span>
                            );
                          })()}
                          <span className="flex-1 min-w-0">
                            <span className="block font-semibold text-sm">
                              {s.label}
                            </span>
                            <span className="block text-[11px] text-surface-400">
                              {s.blurb}
                            </span>
                          </span>
                          {active && (
                            <Check className="w-3.5 h-3.5 text-primary-300 flex-shrink-0 mt-1" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <div className="border-t border-white/5 mt-1 pt-2 px-2 pb-1 text-[10px] text-surface-500 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Picking a scenario tunes the prompt + defaults. Override anything below.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
