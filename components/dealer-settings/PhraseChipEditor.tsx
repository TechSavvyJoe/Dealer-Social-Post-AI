import React, { useId, useState } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { cn } from "../../utils/classNames";
import { BRAND_VOICE_MAX_CHARS, BRAND_VOICE_MAX_ITEMS } from "./settingsModel";
import { FIELD_LABEL, ROW_HELPER } from "./SettingsRows";

interface PhraseChipEditorProps {
  /** Short noun used in every accessible name ("Do" → "Add do phrase"). */
  label: string;
  helperText: string;
  placeholder: string;
  phrases: string[];
  onChange: (next: string[]) => void;
}

const collapsePhrase = (value: string) => value.replace(/\s+/g, " ").trim();

/** Bounded chip list for the structured brand-voice do / don't phrases. */
export const PhraseChipEditor: React.FC<PhraseChipEditorProps> = ({
  label,
  helperText,
  placeholder,
  phrases,
  onChange,
}) => {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const helperId = useId();
  const lowerLabel = label.toLowerCase();
  const full = phrases.length >= BRAND_VOICE_MAX_ITEMS;

  const add = () => {
    const phrase = collapsePhrase(draft);
    if (!phrase) return;
    if (phrase.length > BRAND_VOICE_MAX_CHARS) {
      setError(`Keep each phrase to ${BRAND_VOICE_MAX_CHARS} characters.`);
      return;
    }
    if (full) {
      setError(`Up to ${BRAND_VOICE_MAX_ITEMS} phrases.`);
      return;
    }
    if (phrases.some((existing) => existing.toLowerCase() === phrase.toLowerCase())) {
      setError("That phrase is already listed.");
      return;
    }
    onChange([...phrases, phrase]);
    setDraft("");
    setError(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className={FIELD_LABEL}>{label}</p>
      <ul className="flex flex-wrap gap-1.5" aria-label={`${label} phrases`}>
        {phrases.length === 0 ? (
          <li className="text-sm text-ink-3">None yet</li>
        ) : (
          phrases.map((phrase) => (
            <li
              key={phrase}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-strong bg-panel-raised py-0.5 pl-3 pr-0.5 text-sm text-ink"
            >
              <span>{phrase}</span>
              {/* A 32 px circle with a 44 px hit area: the ::before reaches
                  6 px past it on every side, into the gap before it and the
                  space after the chip, never over the next chip. */}
              <button
                type="button"
                aria-label={`Remove ${lowerLabel} phrase ${phrase}`}
                onClick={() => {
                  onChange(phrases.filter((existing) => existing !== phrase));
                  setError(null);
                }}
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors duration-120 ease-out before:absolute before:-inset-1.5 hover:bg-fill-hover hover:text-ink"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="flex items-start gap-2">
        <Input
          aria-label={`${label} phrase`}
          aria-describedby={error ? undefined : helperId}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
          maxLength={BRAND_VOICE_MAX_CHARS}
          placeholder={placeholder}
          disabled={full}
          error={error || undefined}
          fullWidth
        />
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="shrink-0"
          disabled={full || !collapsePhrase(draft)}
          aria-label={`Add ${lowerLabel} phrase`}
          onClick={add}
        >
          Add
        </Button>
      </div>
      {error ? null : (
        <p id={helperId} className={cn(ROW_HELPER)}>
          {full ? `All ${BRAND_VOICE_MAX_ITEMS} slots used` : helperText}
        </p>
      )}
    </div>
  );
};
