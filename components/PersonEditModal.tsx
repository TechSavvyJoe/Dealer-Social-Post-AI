import React, { useEffect, useState } from "react";
import { Loader2, Save, UserRound } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import type { Person, PersonRole } from "../services/salespeople";
import { updatePerson } from "../services/salespeople";

export interface PersonEditModalProps {
  isOpen: boolean;
  person: Person | null;
  storeName?: string;
  /** Super-admin may change role; managers may not. */
  allowRoleEdit?: boolean;
  onClose: () => void;
  onSaved: (person: Person) => void;
}

/**
 * Shared profile editor for managers and salespeople.
 * Fields match the people roster API: name, pin, active, optional role.
 */
export const PersonEditModal: React.FC<PersonEditModalProps> = ({
  isOpen,
  person,
  storeName,
  allowRoleEdit = false,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [active, setActive] = useState(true);
  const [role, setRole] = useState<PersonRole>("salesperson");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!person) return;
    setName(person.name || "");
    setPin(person.pin || "");
    setActive(person.active !== false);
    setRole(person.role === "manager" ? "manager" : "salesperson");
    setError(null);
  }, [person, isOpen]);

  const handleSave = async () => {
    if (!person?.id) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    if (pin && !/^\d{4}$/.test(pin)) {
      setError("Access code must be exactly 4 digits, or leave blank to keep current.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fields: Partial<Pick<Person, "name" | "pin" | "active" | "role">> = {
        name: trimmed,
        active,
      };
      if (pin) fields.pin = pin;
      if (allowRoleEdit) fields.role = role;
      const updated = await updatePerson(person.id, fields);
      onSaved({
        ...person,
        ...updated,
        name: trimmed,
        pin: pin || person.pin,
        active,
        role: allowRoleEdit ? role : person.role,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen && !!person}
      onClose={onClose}
      size="sm"
      title="Edit profile"
      description={
        storeName
          ? `${person?.name || "Teammate"} · ${storeName}`
          : person?.name || "Teammate"
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} fullWidth disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            fullWidth
            disabled={saving}
            leftIcon={
              saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )
            }
          >
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-500/20 text-primary-200">
            <UserRound className="h-5 w-5" />
          </div>
          <div className="min-w-0 text-sm">
            <div className="font-semibold text-surface-50 truncate">
              {person?.name}
            </div>
            <div className="text-xs text-surface-400">
              {person?.role === "manager" ? "Manager" : "Salesperson"}
              {person?.id ? ` · ID ${person.id.slice(0, 8)}` : ""}
            </div>
          </div>
        </div>

        <Input
          label="Display name"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 120))}
          fullWidth
          autoComplete="name"
        />

        <Input
          label="Access code (4 digits)"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder={person?.pin ? "••••" : "e.g. 4821"}
          helperText="Leave blank to keep the current code. Codes must be unique."
          inputMode="numeric"
          maxLength={4}
          fullWidth
          className="font-mono tracking-widest"
        />

        {allowRoleEdit && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-surface-300">
              Role
            </label>
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value === "manager" ? "manager" : "salesperson")
              }
              className="w-full rounded-xl border border-surface-700 bg-surface-900/70 px-4 py-3 text-surface-50"
            >
              <option value="salesperson">Salesperson (creates posts)</option>
              <option value="manager">Manager (store dashboard)</option>
            </select>
          </div>
        )}

        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-5 w-5 rounded border-surface-600 bg-surface-900 text-primary-500 focus:ring-primary-500"
          />
          <span className="text-sm text-surface-100">
            Active — can sign in and appear in the picker
          </span>
        </label>

        {error && (
          <p className="rounded-lg border border-error-700/40 bg-error-900/30 px-3 py-2 text-xs text-error-100">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};
