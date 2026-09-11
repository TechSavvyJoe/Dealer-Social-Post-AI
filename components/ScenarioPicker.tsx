import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
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
  /**
   * Creative-system layout (spec §8 step 2): the six categories become the
   * primary choice and scenarios drop to optional sub-templates inside the
   * chosen category. Defaults to false, which keeps the listbox exactly as it
   * is today for every dealership that has not opted in.
   */
  categoryFirst?: boolean;
}

/**
 * Canonical category order for the six-tile grid. Any category a dealer's
 * custom scenarios introduce outside this list is appended, so a custom
 * scenario can never disappear from the picker.
 */
const CATEGORY_ORDER: ScenarioCategory[] = [
  "delivery",
  "inventory",
  "service",
  "promo",
  "community",
  "team",
];

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
  categoryFirst = false,
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const labelId = useId();
  const selectedValueId = useId();
  // Category headings are visual only unless each category is a real listbox
  // group, so every heading gets an id that names its role="group" wrapper.
  const categoryLabelId = useId();
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

  // Category-first ordering. Built-in categories keep the canonical order; a
  // dealer-custom category is appended rather than dropped.
  const orderedCategories = useMemo(() => {
    const byCategory = new Map(grouped);
    const known = CATEGORY_ORDER.filter((category) => byCategory.has(category));
    const extra = grouped
      .map(([category]) => category)
      .filter((category) => !CATEGORY_ORDER.includes(category));
    return [...known, ...extra].map(
      (category) => [category, byCategory.get(category) || []] as const,
    );
  }, [grouped]);

  const activeCategory = current?.category;
  const categoryTemplates = useMemo(
    () =>
      activeCategory
        ? allScenarios.filter((scenario) => scenario.category === activeCategory)
        : [],
    [activeCategory, allScenarios],
  );

  // Picking a category selects that category's first scenario, so the
  // sub-template row below is always optional — the category tile alone is a
  // complete decision.
  const selectCategory = useCallback(
    (category: ScenarioCategory) => {
      const first = allScenarios.find((scenario) => scenario.category === category);
      if (!first) return;
      triggerHapticFeedback();
      onChange(first);
    },
    [allScenarios, onChange],
  );

  if (categoryFirst) {
    return (
      <div className={cn("space-y-1.5", className)}>
        <span
          id={labelId}
          className="text-xs font-medium text-surface-300 uppercase tracking-wide"
        >
          Post type
        </span>
        <div
          role="group"
          aria-labelledby={labelId}
          className="grid grid-cols-3 gap-2 sm:grid-cols-6"
        >
          {orderedCategories.map(([category]) => {
            const Icon = SCENARIO_CATEGORY_ICON[category];
            const selected = activeCategory === category;
            return (
              <button
                key={category}
                type="button"
                aria-pressed={selected}
                onClick={() => selectCategory(category)}
                className={cn(
                  "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-2.5 text-center transition-colors",
                  selected
                    ? "border-primary-400 bg-primary-500/20 text-primary-100 [.theme-light_&]:text-primary-950"
                    : "border-hairline bg-fill-subtle text-surface-300 hover:border-primary-400/35 hover:bg-fill-hover",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="text-[11px] font-semibold leading-tight">
                  {SCENARIO_CATEGORY_LABELS[category]}
                </span>
              </button>
            );
          })}
        </div>
        {categoryTemplates.length > 1 ? (
          <div
            role="group"
            aria-labelledby={`${categoryLabelId}-templates`}
            className="space-y-1.5 pt-1"
          >
            <span
              id={`${categoryLabelId}-templates`}
              className="block text-[10px] uppercase tracking-wide text-surface-400"
            >
              Template (optional)
            </span>
            <div className="mobile-h-scroll -mx-1 px-1 pb-1 sm:flex-wrap sm:overflow-visible">
              {categoryTemplates.map((scenario) => {
                const selected = current?.id === scenario.id;
                return (
                  <button
                    key={scenario.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      triggerHapticFeedback();
                      onChange(scenario);
                    }}
                    className={cn(
                      "min-h-11 shrink-0 snap-start rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors",
                      selected
                        ? "border-primary-400 bg-primary-500/25 text-primary-50 [.theme-light_&]:text-primary-950"
                        : "border-hairline bg-fill-subtle text-surface-300 hover:border-primary-400/40",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      {selected ? (
                        <Check className="h-3 w-3 shrink-0" strokeWidth={3} />
                      ) : null}
                      {scenario.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

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
          <m.div
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
              <div
                key={category}
                role="group"
                aria-labelledby={`${categoryLabelId}-${category}`}
                className="mb-2 last:mb-0"
              >
                <div
                  id={`${categoryLabelId}-${category}`}
                  className="text-[10px] uppercase tracking-wide text-surface-400 px-2 pb-1 pt-1.5"
                >
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
                            ? "bg-primary-500/20 text-primary-100 [.theme-light_&]:text-primary-950"
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
                                  ? "bg-primary-500/20 text-primary-200 [.theme-light_&]:text-primary-900"
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
            <div className="border-t border-hairline mt-1 pt-2 px-2 pb-1 text-[10px] text-surface-400 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Picking a scenario tunes the prompt + defaults. Override anything below.
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
};
