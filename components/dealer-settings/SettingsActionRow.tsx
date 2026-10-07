import React from "react";
import { Check } from "lucide-react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import type { SettingsSectionId } from "../../utils/dealerSetupStatus";
import { dirtySectionLabels } from "./settingsModel";

interface SettingsActionRowProps {
  dirty: boolean;
  sectionsDirty: Record<SettingsSectionId, boolean>;
  saving: boolean;
  savedAt: Date | null;
  onSave: () => void;
  onDiscard: () => void;
}

/** The time format the settings have always used for "Saved". */
const savedTime = (date: Date) =>
  date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * One action row for the whole form. From `lg` it sits at the end of the form
 * column; below `lg` it is the bar stuck to the bottom of the screen. It is
 * the form column's last child and stays in flow, so at the end of the page
 * it rests below the last control instead of covering it.
 */
export const SettingsActionRow: React.FC<SettingsActionRowProps> = ({
  dirty,
  sectionsDirty,
  saving,
  savedAt,
  onSave,
  onDiscard,
}) => (
  <div
    data-testid="dealer-settings-save-bar"
    className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline bg-panel px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:gap-x-4 lg:gap-y-3 lg:border-0 lg:bg-transparent lg:p-0"
  >
    <p
      aria-live="polite"
      className="flex min-w-[8rem] flex-1 items-center gap-2 text-sm text-ink-2 lg:order-last lg:flex-none"
    >
      {dirty ? (
        `Unsaved changes in ${dirtySectionLabels(sectionsDirty)}`
      ) : savedAt ? (
        <>
          <Check className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          {`Saved ${savedTime(savedAt)}`}
        </>
      ) : (
        "Up to date"
      )}
    </p>
    <div className="ml-auto flex items-center gap-2 lg:contents">
      {dirty ? (
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="px-4 lg:order-2"
          disabled={saving}
          onClick={onDiscard}
        >
          Discard
        </Button>
      ) : null}
      <Button
        type="button"
        variant="primary"
        size="lg"
        className="lg:order-1"
        disabled={!dirty || saving}
        loading={saving}
        onClick={onSave}
      >
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  </div>
);

interface DiscardSettingsDialogProps {
  isOpen: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}

/**
 * The one "Discard unsaved settings?" question, asked when the manager leaves
 * the Settings tab with edits and when they press Discard. Either way the
 * edits are dropped and every field shows the saved record again.
 */
export const DiscardSettingsDialog: React.FC<DiscardSettingsDialogProps> = ({
  isOpen,
  onKeep,
  onDiscard,
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onKeep}
    size="sm"
    title="Discard unsaved settings?"
    footer={
      <>
        <Button variant="secondary" fullWidth onClick={onKeep}>
          Keep editing
        </Button>
        <Button variant="danger" fullWidth onClick={onDiscard}>
          Discard changes
        </Button>
      </>
    }
  >
    <p className="text-sm text-ink-2">
      Your changes to the dealership settings have not been saved. Discarding them puts
      every field back to what was last saved.
    </p>
  </Modal>
);
