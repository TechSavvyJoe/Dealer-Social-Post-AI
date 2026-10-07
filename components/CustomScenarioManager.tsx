import React, { useId, useMemo, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Save, X, Pencil, Loader2 } from "lucide-react";
import { Input, Textarea } from "./ui/Input";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
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
import { toUiMessage } from "../utils/errorMessages";

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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const categoryId = useId();
  const defaultStyleId = useId();
  const defaultToneId = useId();
  const headingId = useId();

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
      setError(toUiMessage(err, "Could not save your scenarios."));
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
      setError("Prompt additions are required. They are what tunes the AI.");
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

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await persist(scenarios.filter((s) => s.id !== pendingDeleteId));
    } catch {
      /* error surfaced by persist */
    } finally {
      // Always close, even on failure — the error banner renders behind the
      // modal overlay and would otherwise stay hidden.
      setPendingDeleteId(null);
    }
  };

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          {/* An h4 like its siblings in "Video and advanced" (SettingsSubgroup). */}
          <h4 id={headingId} className="text-lg leading-6 text-ink">
            Custom scenarios
          </h4>
          <p className="text-sm text-ink-2">
            Add your own post types. Each one appears on your team&rsquo;s Home screen
            as an extra tile.
          </p>
        </div>
        {!editing && (
          <Button
            variant="secondary"
            size="md"
            className="shrink-0 whitespace-nowrap px-3.5 text-sm"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={startNew}
            disabled={saving}
          >
            Add scenario
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-sm border border-error-ink/30 bg-error-fill px-3 py-2 text-sm text-error-ink"
        >
          {error}
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <m.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-4 rounded-md border border-hairline bg-panel p-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Label"
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                placeholder="Spring Clearance, F-150"
                fullWidth
              />
              <div>
                <label
                  htmlFor={categoryId}
                  className="block text-sm font-medium text-ink-2"
                >
                  Category
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  {(() => {
                    const Icon = SCENARIO_CATEGORY_ICON[editing.category];
                    return (
                      <span
                        className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-sm border border-hairline bg-panel-raised"
                        title="Tile icon (set automatically by category)"
                      >
                        <Icon className="w-5 h-5 text-ink-2" aria-hidden="true" />
                      </span>
                    );
                  })()}
                  <select
                    id={categoryId}
                    value={editing.category}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        category: e.target.value as ScenarioCategory,
                      })
                    }
                    className="min-h-11 w-full rounded-sm border border-strong bg-panel-raised px-3 text-base text-ink transition-colors duration-120 ease-out focus:border-brand-ink"
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
              label="Short blurb (shown on the Home tile)"
              value={editing.blurb || ""}
              onChange={(e) => setEditing({ ...editing, blurb: e.target.value })}
              placeholder="F-150 push, April 1 to 30"
              fullWidth
            />

            <Textarea
              label="Prompt additions (the AI instruction)"
              value={editing.promptAdditions || ""}
              onChange={(e) =>
                setEditing({ ...editing, promptAdditions: e.target.value })
              }
              rows={4}
              fullWidth
              placeholder={`Scenario: April F-150 clearance push. Emphasize trim levels still on the lot. Soft "limited stock" framing, never "guaranteed lowest price". End with CTA to schedule a test drive this weekend.`}
              className="font-mono text-sm"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor={defaultStyleId}
                  className="block text-sm font-medium text-ink-2"
                >
                  Default style
                </label>
                <select
                  id={defaultStyleId}
                  value={editing.defaultStyle}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      defaultStyle: e.target.value as StyleOption,
                    })
                  }
                  className="mt-1.5 min-h-11 w-full rounded-sm border border-strong bg-panel-raised px-3 text-base text-ink transition-colors duration-120 ease-out focus:border-brand-ink"
                >
                  {Object.values(StyleOption).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor={defaultToneId}
                  className="block text-sm font-medium text-ink-2"
                >
                  Default tone
                </label>
                <select
                  id={defaultToneId}
                  value={editing.defaultTone}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      defaultTone: e.target.value as ToneOption,
                    })
                  }
                  className="mt-1.5 min-h-11 w-full rounded-sm border border-strong bg-panel-raised px-3 text-base text-ink transition-colors duration-120 ease-out focus:border-brand-ink"
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
              className="font-mono text-sm"
            />

            <Input
              label="Starter caption (optional)"
              value={editing.starterCaption || ""}
              onChange={(e) =>
                setEditing({ ...editing, starterCaption: e.target.value })
              }
              placeholder="The F-150 you've been waiting on is here."
              fullWidth
            />

            <div className="flex flex-wrap gap-x-5 text-sm text-ink-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!editing.requiresCustomer}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      requiresCustomer: e.target.checked,
                    })
                  }
                  className="h-[18px] w-[18px] accent-brand-ink"
                />
                Requires customer in photo
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!editing.requiresVehicle}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      requiresVehicle: e.target.checked,
                    })
                  }
                  className="h-[18px] w-[18px] accent-brand-ink"
                />
                Requires vehicle in photo
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-hairline">
              <Button
                variant="ghost"
                size="md"
                leftIcon={<X className="w-4 h-4" />}
                onClick={cancelEdit}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="md"
                leftIcon={
                  saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )
                }
                onClick={handleSubmit}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save scenario"}
              </Button>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {scenarios.length === 0 ? (
        <p className="text-sm text-ink-3">
          No custom scenarios yet. Add one to give your team more on-brand options.
        </p>
      ) : (
        <ul className="border-b border-hairline">
          {scenarios.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 border-t border-hairline py-2.5"
            >
              <div className="min-w-0 flex items-start gap-3">
                {(() => {
                  const Icon = SCENARIO_CATEGORY_ICON[s.category];
                  return (
                    <Icon
                      className="mt-1 h-4 w-4 flex-shrink-0 text-ink-2"
                      aria-hidden="true"
                    />
                  );
                })()}
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-ink">
                    {s.label}
                    <span className="ml-2 text-caption font-normal text-ink-2">
                      {SCENARIO_CATEGORY_LABELS[s.category]}
                    </span>
                  </div>
                  <div className="truncate text-sm text-ink-2">
                    {s.blurb || s.promptAdditions.split("\n")[0]}
                  </div>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(s)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 text-sm font-semibold text-ink-2",
                    "transition-colors duration-120 ease-out hover:bg-fill-subtle hover:text-ink",
                  )}
                  title="Edit scenario"
                  aria-label={`Edit ${s.label}`}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDeleteId(s.id)}
                  className={cn(
                    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-error-ink",
                    "transition-colors duration-120 ease-out hover:bg-error-fill",
                  )}
                  title="Delete scenario"
                  aria-label={`Delete ${s.label}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={pendingDeleteId !== null}
        onClose={() => setPendingDeleteId(null)}
        size="sm"
        title="Delete this scenario?"
        description="This can't be undone."
        disableClose={saving}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setPendingDeleteId(null)}
              disabled={saving}
              fullWidth
            >
              Keep scenario
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirmDelete()}
              disabled={saving}
              fullWidth
            >
              {saving ? "Deleting…" : "Delete scenario"}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-2">
          {(() => {
            const pending = scenarios.find((s) => s.id === pendingDeleteId);
            return pending
              ? `Removing “${pending.label}” takes its tile off the Home screen for your whole team.`
              : "Removing this scenario takes its tile off the Home screen for your whole team.";
          })()}
        </p>
      </Modal>
    </section>
  );
};
