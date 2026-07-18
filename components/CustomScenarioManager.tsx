import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Save, X, Pencil, Loader2 } from "lucide-react";
import { Input, Textarea } from "./ui/Input";
import { Button } from "./ui/Button";
import {
  PostScenario,
  ScenarioCategory,
  SCENARIO_CATEGORY_LABELS,
  SCENARIO_CATEGORY_ICON,
  parseCustomScenarios,
  serializeCustomScenarios,
} from "../services/postScenarios";
import { StyleOption, ToneOption } from "../types";
import { cn } from "../utils/classNames";

interface CustomScenarioManagerProps {
  /** Current value of dealer.custom_scenarios (JSON string). */
  customScenariosJson?: string;
  /** Persist updated JSON to the dealer record. */
  onSave: (json: string) => Promise<unknown>;
}

interface EditingState extends Partial<PostScenario> {
  id: string;
  label: string;
  emoji: string;
  category: ScenarioCategory;
}

const blankScenario = (): EditingState => ({
  // Collision-resistant id: two scenarios created in the same millisecond used
  // to get the same `Date.now()` id, and the save filter (`id !== next.id`)
  // would then silently replace the first with the second.
  id: `custom_${
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8)
  }`,
  label: "",
  emoji: "✨",
  category: "promo",
  blurb: "",
  defaultStyle: StyleOption.Modern,
  defaultTone: ToneOption.Promotional,
  requiresCustomer: false,
  requiresVehicle: true,
  promptAdditions: "",
  suggestedHashtags: [],
  starterCaption: "",
});

/**
 * GSM-facing custom scenario CRUD. Stores scenarios as a serialized JSON
 * array in the dealer record. List + inline edit + add. Deletion is a
 * destructive action so confirmation is required.
 */
export const CustomScenarioManager: React.FC<CustomScenarioManagerProps> = ({
  customScenariosJson,
  onSave,
}) => {
  const scenarios = useMemo(
    () => parseCustomScenarios(customScenariosJson),
    [customScenariosJson],
  );

  const [editing, setEditing] = useState<EditingState | null>(null);
  const [hashtagsInput, setHashtagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startNew = () => {
    setEditing(blankScenario());
    setHashtagsInput("");
    setError(null);
  };

  const startEdit = (s: PostScenario) => {
    setEditing({
      id: s.id,
      label: s.label,
      emoji: s.emoji,
      category: s.category,
      blurb: s.blurb,
      defaultStyle: s.defaultStyle,
      defaultTone: s.defaultTone,
      requiresCustomer: s.requiresCustomer,
      requiresVehicle: s.requiresVehicle,
      promptAdditions: s.promptAdditions,
      suggestedHashtags: s.suggestedHashtags,
      starterCaption: s.starterCaption || "",
    });
    setHashtagsInput((s.suggestedHashtags || []).join(" "));
    setError(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setHashtagsInput("");
    setError(null);
  };

  const persist = async (next: PostScenario[]) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(serializeCustomScenarios(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!editing) return;
    if (!editing.label.trim()) {
      setError("Label is required.");
      return;
    }
    if (!editing.promptAdditions || !editing.promptAdditions.trim()) {
      setError("Prompt additions are required — this is what tunes the AI.");
      return;
    }
    const tags = hashtagsInput
      .split(/[\s,]+/)
      .map((t) => t.trim().replace(/^#+/, ""))
      .filter(Boolean)
      .map((t) => `#${t}`);
    const next: PostScenario = {
      id: editing.id,
      label: editing.label.trim().slice(0, 60),
      emoji: (editing.emoji || "✨").slice(0, 4),
      category: editing.category,
      blurb: (editing.blurb || "").slice(0, 80),
      defaultStyle: editing.defaultStyle as StyleOption,
      defaultTone: editing.defaultTone as ToneOption,
      requiresCustomer: !!editing.requiresCustomer,
      requiresVehicle: !!editing.requiresVehicle,
      promptAdditions: editing.promptAdditions.trim(),
      suggestedHashtags: tags,
      starterCaption: editing.starterCaption?.trim() || undefined,
    };
    const without = scenarios.filter((s) => s.id !== next.id);
    try {
      await persist([...without, next]);
      setEditing(null);
      setHashtagsInput("");
    } catch {
      /* error already surfaced */
    }
  };

  const handleDelete = async (id: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this scenario? This cannot be undone.")
    ) {
      return;
    }
    try {
      await persist(scenarios.filter((s) => s.id !== id));
    } catch {
      /* surfaced */
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-surface-50">Custom scenarios</div>
          <p className="text-[11px] text-surface-400">
            Define your own post types alongside the 12 built-in ones. They appear in
            the showroom picker with your team's options.
          </p>
        </div>
        {!editing && (
          <Button
            variant="filled"
            size="sm"
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            onClick={startNew}
            disabled={saving}
            style={{
              background:
                "linear-gradient(135deg, var(--brand-primary-500), var(--brand-primary))",
            }}
          >
            Add scenario
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-error-700/50 bg-error-900/40 px-3 py-2 text-error-100 text-xs">
          {error}
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="rounded-xl border border-primary-500/30 bg-primary-500/5 p-3 space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                label="Label"
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                placeholder="Spring Clearance — F-150"
                fullWidth
                className="bg-white/5 border-white/10 focus:border-primary-400"
              />
              <div>
                <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                  Category
                </label>
                <div className="mt-1 flex items-center gap-2">
                  {(() => {
                    const Icon = SCENARIO_CATEGORY_ICON[editing.category];
                    return (
                      <span
                        className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-primary-500/10 border border-primary-500/20"
                        title="Tile icon (set automatically by category)"
                      >
                        <Icon className="w-5 h-5 text-primary-300" />
                      </span>
                    );
                  })()}
                  <select
                    value={editing.category}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        category: e.target.value as ScenarioCategory,
                      })
                    }
                    className="w-full bg-surface-900/60 border-2 border-surface-700 focus:border-primary-500 rounded-xl px-3 py-3 text-base text-surface-50"
                  >
                    {Object.entries(SCENARIO_CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <Input
              label="Short blurb (shown on the picker tile)"
              value={editing.blurb || ""}
              onChange={(e) => setEditing({ ...editing, blurb: e.target.value })}
              placeholder="F-150 push, April 1–30"
              fullWidth
              className="bg-white/5 border-white/10 focus:border-primary-400"
            />

            <Textarea
              label="Prompt additions (the AI instruction)"
              value={editing.promptAdditions || ""}
              onChange={(e) =>
                setEditing({ ...editing, promptAdditions: e.target.value })
              }
              rows={4}
              fullWidth
              placeholder={`Scenario: April F-150 clearance push. Emphasize trim levels still on the lot. Soft "limited stock" framing — never "guaranteed lowest price". End with CTA to schedule a test drive this weekend.`}
              className="bg-white/5 border-white/10 focus:border-primary-400 font-mono text-sm"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                  Default style
                </label>
                <select
                  value={editing.defaultStyle}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      defaultStyle: e.target.value as StyleOption,
                    })
                  }
                  className="mt-1 w-full bg-surface-900/60 border-2 border-surface-700 focus:border-primary-500 rounded-xl px-3 py-3 text-base text-surface-50"
                >
                  {Object.values(StyleOption).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                  Default tone
                </label>
                <select
                  value={editing.defaultTone}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      defaultTone: e.target.value as ToneOption,
                    })
                  }
                  className="mt-1 w-full bg-surface-900/60 border-2 border-surface-700 focus:border-primary-500 rounded-xl px-3 py-3 text-base text-surface-50"
                >
                  {Object.values(ToneOption).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Input
              label="Suggested hashtags (space or comma separated, # optional)"
              value={hashtagsInput}
              onChange={(e) => setHashtagsInput(e.target.value)}
              placeholder="#F150 #SpringEvent #TruckMonth"
              fullWidth
              className="bg-white/5 border-white/10 focus:border-primary-400 font-mono text-sm"
            />

            <Input
              label="Starter caption (optional)"
              value={editing.starterCaption || ""}
              onChange={(e) =>
                setEditing({ ...editing, starterCaption: e.target.value })
              }
              placeholder="The F-150 you've been waiting on is here."
              fullWidth
              className="bg-white/5 border-white/10 focus:border-primary-400"
            />

            <div className="flex flex-wrap gap-3 text-[11px] text-surface-300 pt-1">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={!!editing.requiresCustomer}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      requiresCustomer: e.target.checked,
                    })
                  }
                  className="rounded border-white/20 bg-white/5"
                />
                Requires customer in photo
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={!!editing.requiresVehicle}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      requiresVehicle: e.target.checked,
                    })
                  }
                  className="rounded border-white/20 bg-white/5"
                />
                Requires vehicle in photo
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<X className="w-3.5 h-3.5" />}
                onClick={cancelEdit}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                variant="filled"
                size="sm"
                leftIcon={
                  saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )
                }
                onClick={handleSubmit}
                disabled={saving}
                style={{
                  background:
                    "linear-gradient(135deg, var(--brand-primary-500), var(--brand-primary))",
                }}
              >
                {saving ? "Saving…" : "Save scenario"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {scenarios.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4 text-center text-xs text-surface-400">
          No custom scenarios yet — add one to give your team more on-brand options.
        </div>
      ) : (
        <ul className="space-y-2">
          {scenarios.map((s) => (
            <li
              key={s.id}
              className="rounded-xl border border-white/10 bg-surface-900/40 px-3 py-2.5 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex items-start gap-2.5">
                {(() => {
                  const Icon = SCENARIO_CATEGORY_ICON[s.category];
                  return (
                    <span className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.06] text-surface-300 mt-0.5">
                      <Icon className="w-4 h-4" />
                    </span>
                  );
                })()}
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-surface-50 truncate">
                    {s.label}
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-surface-500">
                      {SCENARIO_CATEGORY_LABELS[s.category]}
                    </span>
                  </div>
                  <div className="text-[11px] text-surface-400 truncate">
                    {s.blurb || s.promptAdditions.split("\n")[0]}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => startEdit(s)}
                  className={cn(
                    "text-[11px] px-2 py-1 rounded-md transition-colors",
                    "bg-white/5 hover:bg-white/10 text-surface-200",
                    "flex items-center gap-1",
                  )}
                  title="Edit scenario"
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(s.id)}
                  className={cn(
                    "text-[11px] px-2 py-1 rounded-md transition-colors",
                    "bg-error-500/10 hover:bg-error-500/20 text-error-200",
                    "flex items-center gap-1",
                  )}
                  title="Delete scenario"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
