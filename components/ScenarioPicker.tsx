import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const labelId = useId();
  const selectedValueId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shouldRestoreTriggerFocusRef = useRef(false);
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
  const currentIndex = Math.max(
    0,
    allScenarios.findIndex((scenario) => scenario.id === current?.id),
  );

  const focusOption = useCallback(
    (index: number) => {
      if (!allScenarios.length) return;
      const nextIndex = (index + allScenarios.length) % allScenarios.length;
      setActiveIndex(nextIndex);
    },
    [allScenarios.length],
  );

  const closeAndRestoreFocus = useCallback(() => {
    shouldRestoreTriggerFocusRef.current = true;
    setOpen(false);
  }, []);

  const selectScenario = useCallback(
    (scenario: PostScenario) => {
      triggerHapticFeedback();
      onChange(scenario);
      closeAndRestoreFocus();
    },
    [closeAndRestoreFocus, onChange],
  );

  const openListbox = useCallback(() => {
    setOpen(true);
    focusOption(currentIndex);
  }, [currentIndex, focusOption]);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (open) {
      optionRefs.current[activeIndex]?.focus();
      return;
    }

    if (shouldRestoreTriggerFocusRef.current) {
      shouldRestoreTriggerFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [activeIndex, open]);

  const handleListboxKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusOption(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusOption(activeIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusOption(0);
        break;
      case "End":
        event.preventDefault();
        focusOption(allScenarios.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        closeAndRestoreFocus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className={cn("space-y-1.5", className)}>
      <span
        id={labelId}
        className="text-xs font-medium text-surface-300 uppercase tracking-wide"
      >
        Post type
      </span>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-labelledby={`${labelId} ${selectedValueId}`}
        onClick={() => {
          triggerHapticFeedback();
          if (open) {
            setOpen(false);
          } else {
            openListbox();
          }
        }}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            openListbox();
          }
        }}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl",
          "bg-fill-subtle border border-hairline hover:bg-fill-hover transition-colors",
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
            <span
              id={selectedValueId}
              className="block text-surface-50 truncate font-semibold"
            >
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
            aria-labelledby={labelId}
            onKeyDown={handleListboxKeyDown}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="rounded-xl border border-hairline bg-surface-900/95 backdrop-blur-xl shadow-2xl p-2 max-h-96 overflow-y-auto"
          >
            {grouped.map(([category, list]) => (
              <div key={category} role="presentation" className="mb-2 last:mb-0">
                <div className="text-[10px] uppercase tracking-wide text-surface-500 px-2 pb-1 pt-1.5">
                  {SCENARIO_CATEGORY_LABELS[category]}
                </div>
                <div role="presentation" className="space-y-0.5">
                  {list.map((s) => {
                    const active = (value || POST_SCENARIOS[0].id) === s.id;
                    const scenarioIndex = allScenarios.findIndex(
                      (candidate) => candidate.id === s.id,
                    );
                    return (
                      <button
                        key={s.id}
                        ref={(element) => {
                          optionRefs.current[scenarioIndex] = element;
                        }}
                        type="button"
                        role="option"
                        tabIndex={activeIndex === scenarioIndex ? 0 : -1}
                        aria-selected={active}
                        onFocus={() => setActiveIndex(scenarioIndex)}
                        onClick={() => selectScenario(s)}
                        className={cn(
                          "w-full flex items-start gap-2 px-2 py-2 rounded-lg text-left transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900",
                          active
                            ? "bg-primary-500/20 text-primary-100"
                            : "hover:bg-fill-subtle text-surface-100",
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
                                  : "bg-fill-subtle text-surface-300",
                              )}
                            >
                              <Icon className="w-4 h-4" />
                            </span>
                          );
                        })()}
                        <span className="flex-1 min-w-0">
                          <span className="block font-semibold text-sm">{s.label}</span>
                          <span className="block text-[11px] text-surface-400">
                            {s.blurb}
                          </span>
                        </span>
                        {active && (
                          <Check className="w-3.5 h-3.5 text-primary-300 flex-shrink-0 mt-1" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="border-t border-hairline mt-1 pt-2 px-2 pb-1 text-[10px] text-surface-500 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Picking a scenario tunes the prompt + defaults. Override anything below.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
