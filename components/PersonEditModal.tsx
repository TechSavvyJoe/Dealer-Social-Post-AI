import React, { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Shield,
  UserRound,
} from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { cn } from "../utils/classNames";
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

const generatePin = (): string => {
  // Avoid weak patterns like 0000–0999 being only low entropy; use full 0000–9999
  // via crypto when available.
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return String(buf[0] % 10000).padStart(4, "0");
  }
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
};

/**
 * Profile editor for managers and salespeople.
 * Access codes stay hidden by default — set only via rotate / explicit change.
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
  const [active, setActive] = useState(true);
  const [role, setRole] = useState<PersonRole>("salesperson");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** When non-null, a new pin will be saved on submit. Never prefilled from API. */
  const [pendingPin, setPendingPin] = useState<string | null>(null);
  const [showPendingPin, setShowPendingPin] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualPin, setManualPin] = useState("");
  const [copied, setCopied] = useState(false);
  const [hasExistingCode, setHasExistingCode] = useState(false);

  useEffect(() => {
    if (!person || !isOpen) return;
    setName(person.name || "");
    setActive(person.active !== false);
    setRole(person.role === "manager" ? "manager" : "salesperson");
    setHasExistingCode(Boolean(person.pin && person.pin.length > 0));
    setPendingPin(null);
    setShowPendingPin(false);
    setManualMode(false);
    setManualPin("");
    setCopied(false);
    setError(null);
  }, [person, isOpen]);

  const handleRotate = () => {
    const next = generatePin();
    setPendingPin(next);
    setShowPendingPin(true);
    setManualMode(false);
    setManualPin("");
    setCopied(false);
  };

  const handleManualApply = () => {
    if (!/^\d{4}$/.test(manualPin)) {
      setError("Access code must be exactly 4 digits.");
      return;
    }
    setPendingPin(manualPin);
    setShowPendingPin(true);
    setError(null);
    setCopied(false);
  };

  const handleCopy = async () => {
    if (!pendingPin) return;
    try {
      await navigator.clipboard.writeText(pendingPin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Write the code down before saving.");
    }
  };

  const handleSave = async () => {
    if (!person?.id) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    if (pendingPin && !/^\d{4}$/.test(pendingPin)) {
      setError("Access code must be exactly 4 digits.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fields: Partial<Pick<Person, "name" | "pin" | "active" | "role">> = {
        name: trimmed,
        active,
      };
      if (pendingPin) fields.pin = pendingPin;
      if (allowRoleEdit) fields.role = role;
      const updated = await updatePerson(person.id, fields);
      onSaved({
        ...person,
        ...updated,
        name: trimmed,
        // Do not echo pin back into list state for display
        pin: pendingPin ? undefined : person.pin ? "****" : undefined,
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

  const roleLabel =
    (allowRoleEdit ? role : person?.role) === "manager"
      ? "Manager"
      : "Salesperson";

  return (
    <Modal
      isOpen={isOpen && !!person}
      onClose={onClose}
      size="md"
      title="Account settings"
      description={
        storeName
          ? `${storeName} · secure profile`
          : "Secure profile"
      }
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="min-h-12 sm:min-w-[7rem]"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={saving}
            className="min-h-12 sm:min-w-[10rem]"
            leftIcon={
              saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )
            }
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Identity header */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-surface-800/80 to-surface-900/90 p-4">
          <div
            className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-primary-500/10 blur-2xl"
            aria-hidden
          />
          <div className="relative flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-500/15 ring-1 ring-primary-400/20">
              <UserRound className="h-6 w-6 text-primary-200" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-surface-50">
                {person?.name}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-surface-400">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 font-medium text-surface-300">
                  {roleLabel}
                </span>
                {storeName ? (
                  <span className="truncate">{storeName}</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Profile */}
        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-surface-500">
            Profile
          </h3>
          <Input
            label="Display name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 120))}
            fullWidth
            autoComplete="name"
          />

          {allowRoleEdit && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-surface-300">
                Role
              </label>
              <select
                value={role}
                onChange={(e) =>
                  setRole(
                    e.target.value === "manager" ? "manager" : "salesperson",
                  )
                }
                className="w-full rounded-xl border border-surface-700 bg-surface-900/70 px-4 py-3 text-surface-50 focus:border-primary-500 focus:outline-none"
              >
                <option value="salesperson">
                  Salesperson — create posts
                </option>
                <option value="manager">
                  Manager — store dashboard & team
                </option>
              </select>
            </div>
          )}
        </section>

        {/* Security */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-primary-300" />
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-surface-500">
              Security
            </h3>
          </div>

          <div className="rounded-2xl border border-white/10 bg-surface-950/50 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
                  <KeyRound className="h-4 w-4 text-surface-300" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-surface-50">
                    Access code
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-surface-400">
                    4-digit sign-in code. Never shown in lists. Share only in
                    person or a private channel. Generating a new code ends
                    their current sessions — next sign-in must use the new
                    code.
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
                  pendingPin
                    ? "bg-warning-500/15 text-warning-200 ring-1 ring-warning-500/30"
                    : hasExistingCode
                      ? "bg-success-500/15 text-success-200 ring-1 ring-success-500/25"
                      : "bg-surface-800 text-surface-400 ring-1 ring-white/10",
                )}
              >
                {pendingPin
                  ? "New code"
                  : hasExistingCode
                    ? "Protected"
                    : "Not set"}
              </span>
            </div>

            {pendingPin ? (
              <div className="rounded-xl border border-primary-500/25 bg-primary-500/10 px-3 py-3 space-y-2">
                <p className="text-[11px] font-medium text-primary-100/90">
                  Save this code now — it won’t appear in the roster after you
                  leave this screen. On save, their open sessions end so the
                  next sign-in uses this code only.
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 items-center justify-between rounded-lg border border-white/10 bg-surface-950/80 px-3 py-2.5 font-mono text-lg tracking-[0.35em] text-surface-50">
                    <span>
                      {showPendingPin
                        ? pendingPin
                        : "••••"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowPendingPin((v) => !v)}
                      className="ml-2 inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-surface-400 hover:bg-white/5 hover:text-surface-100"
                      aria-label={
                        showPendingPin ? "Hide access code" : "Show access code"
                      }
                    >
                      {showPendingPin ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCopy()}
                    leftIcon={
                      copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )
                    }
                    className="min-h-11 shrink-0"
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 flex-1"
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={handleRotate}
              >
                {hasExistingCode || pendingPin
                  ? "Generate new code"
                  : "Generate code"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 flex-1"
                onClick={() => {
                  setManualMode((v) => !v);
                  setError(null);
                }}
              >
                {manualMode ? "Cancel manual entry" : "Set code manually"}
              </Button>
            </div>

            {manualMode && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Input
                    label="New 4-digit code"
                    value={manualPin}
                    onChange={(e) =>
                      setManualPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    inputMode="numeric"
                    maxLength={4}
                    autoComplete="new-password"
                    fullWidth
                    className="font-mono tracking-[0.3em]"
                    helperText="Unique across all active users."
                  />
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="min-h-11 sm:mb-0.5"
                  disabled={manualPin.length !== 4}
                  onClick={handleManualApply}
                >
                  Use this code
                </Button>
              </div>
            )}

            {pendingPin && (
              <button
                type="button"
                className="text-xs font-medium text-surface-500 underline-offset-2 hover:text-surface-300 hover:underline"
                onClick={() => {
                  setPendingPin(null);
                  setShowPendingPin(false);
                  setManualPin("");
                  setManualMode(false);
                }}
              >
                Discard new code (keep current)
              </button>
            )}
          </div>

          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-surface-950/40 px-4 py-3.5 transition-colors hover:border-white/15">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-5 w-5 rounded border-surface-600 bg-surface-900 text-primary-500 focus:ring-primary-500"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-surface-100">
                Account active
              </span>
              <span className="block text-xs text-surface-500">
                When off, this person can’t sign in and won’t appear in the
                showroom picker. Past posts stay intact.
              </span>
            </span>
          </label>
        </section>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-error-700/40 bg-error-900/30 px-3 py-2.5 text-xs text-error-100"
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};
