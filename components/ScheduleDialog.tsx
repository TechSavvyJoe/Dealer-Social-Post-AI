import React, { useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Calendar, Clock } from "lucide-react";

interface ScheduleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSchedule: (isoString: string) => void;
  isLoading?: boolean;
}

export const ScheduleDialog: React.FC<ScheduleDialogProps> = ({
  isOpen,
  onClose,
  onSchedule,
  isLoading,
}) => {
  const [dateStr, setDateStr] = useState("");

  const handleConfirm = () => {
    if (!dateStr) return;
    const isoString = new Date(dateStr).toISOString();
    onSchedule(isoString);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Plan a share time"
      size="sm"
      className="bg-surface-900 border-surface-800"
    >
      <div className="space-y-4 mb-4">
        <p className="text-sm text-surface-300">
          We save this time with the post so you can come back and share it then.
          Nothing posts on its own.
        </p>

        <div className="space-y-2">
          <label
            htmlFor="schedule-datetime"
            className="text-xs font-semibold text-surface-200 uppercase tracking-wider"
          >
            Share date &amp; time
          </label>
          <div className="relative">
            <input
              id="schedule-datetime"
              type="datetime-local"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              min={new Date().toISOString().slice(0, 16)} // Only allow future dates
              className="w-full bg-surface-800/80 border border-surface-700 rounded-lg px-4 py-3 text-surface-50 [.theme-light_&]:text-surface-950 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose} fullWidth disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="filled"
          onClick={handleConfirm}
          disabled={!dateStr || isLoading}
          loading={isLoading}
          fullWidth
          leftIcon={<Calendar className="w-4 h-4" />}
        >
          Save time
        </Button>
      </div>
    </Modal>
  );
};
