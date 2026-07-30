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
import type { CredentialResult, Person, PersonRole } from "../services/salespeople";
import {
  acknowledgePinDistribution,
  revealPersonPin,
  rotatePersonPin,
  updatePerson,
} from "../services/salespeople";

export interface PersonEditModalProps {
  isOpen: boolean;
  person: Person | null;
  storeName?: string;
  /** Super-admin may change role; managers may not. */
  allowRoleEdit?: boolean;
  /** Super-admin-only audited reveal action. */
  allowPinReveal?: boolean;
  onClose: () => void;
  onSaved: (person: Person) => void;
  /** Called as soon as a server-side credential/status mutation commits. */
  onCommitted?: (person: Person) => void;
  /** Hoists a one-time credential so closing the modal cannot discard it. */
  onCredentialIssued?: (credential: CredentialResult) => void;
}

/**
 * Profile editor for managers and salespeople.
 * Access codes stay hidden by default — set only via rotate / explicit change.
 */
export const PersonEditModal: React.FC<PersonEditModalProps> = ({
  isOpen,
  person,
  storeName,
  allowRoleEdit = false,
  allowPinReveal = false,
  onClose,
  onSaved,
  onCommitted,
  onCredentialIssued,
}) => {
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [role, setRole] = useState<PersonRole>("salesperson");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [credentialPin, setCredentialPin] = useState<string | null>(null);
  const [showCredentialPin, setShowCredentialPin] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasExistingCode, setHasExistingCode] = useState(false);
  const [needsDistribution, setNeedsDistribution] = useState(false);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const roleSelectId = React.useId();

  useEffect(() => {
    if (!person || !isOpen) return;
    setName(person.name || "");
    setActive(person.active !== false);
    setRole(person.role === "manager" ? "manager" : "salesperson");
    setHasExistingCode(person.hasPin);
    setNeedsDistribution(person.pinNeedsDistribution);
    setCredentialPin(null);
    setShowCredentialPin(false);
    setCopied(false);
    setConfirmingRotate(false);
    setError(null);
  }, [person, isOpen]);

  const showCredential = (pin: string, pinNeedsDistribution: boolean) => {
    setCredentialPin(pin);
    setShowCredentialPin(true);
    setHasExistingCode(true);
    setNeedsDistribution(pinNeedsDistribution);
    setCopied(false);
    setConfirmingRotate(false);
  };

  const handleRotate = async () => {
    if (!person?.id) return;
    setCredentialBusy(true);
    setError(null);
    try {
      const result = await rotatePersonPin(person.id);
      showCredential(result.pin, result.person.pinNeedsDistribution);
      onCommitted?.(result.person);
      onCredentialIssued?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rotate the code.");
    } finally {
      setCredentialBusy(false);
    }
  };

  const handleReveal = async () => {
    if (!person?.id || !allowPinReveal) return;
    setCredentialBusy(true);
    setError(null);
    try {
      const result = await revealPersonPin(person.id);
      showCredential(result.pin, result.person.pinNeedsDistribution);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reveal the code.");
    } finally {
      setCredentialBusy(false);
    }
  };

  const handleAcknowledge = async () => {
    if (!person?.id) return;
    setCredentialBusy(true);
    setError(null);
    try {
      const updated = await acknowledgePinDistribution(person.id);
      setNeedsDistribution(updated.pinNeedsDistribution);
      setCredentialPin(null);
      setShowCredentialPin(false);
      onCommitted?.(updated);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not mark the code as shared.",
      );
    } finally {
      setCredentialBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!credentialPin) return;
    try {
      await navigator.clipboard.writeText(credentialPin);
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
    setSaving(true);
    setError(null);
    try {
      const fields: Partial<Pick<Person, "name" | "active" | "role">> = {
        name: trimmed,
        active,
      };
      if (allowRoleEdit) fields.role = role;
      const updated = await updatePerson(person.id, fields);
      onSaved({
        ...person,
        ...updated,
        name: trimmed,
        hasPin: hasExistingCode,
        pinNeedsDistribution: needsDistribution,
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
    (allowRoleEdit ? role : person?.role) === "manager" ? "Manager" : "Salesperson";

  return (
    <Modal
      isOpen={isOpen && !!person}
      onClose={onClose}
      size="md"
      title="Account settings"
      description={storeName ? `${storeName} · secure profile` : "Secure profile"}
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
                {storeName ? <span className="truncate">{storeName}</span> : null}
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
              <label
                htmlFor={roleSelectId}
                className="mb-1.5 block text-sm font-medium text-surface-300"
              >
                Role
              </label>
              <select
                id={roleSelectId}
                value={role}
                onChange={(e) =>
                  setRole(e.target.value === "manager" ? "manager" : "salesperson")
                }
                className="w-full rounded-xl border border-surface-700 bg-surface-900/70 px-4 py-3 text-surface-50 focus:border-primary-500 focus:outline-none"
              >
                <option value="salesperson">Salesperson — create posts</option>
                <option value="manager">Manager — store dashboard & team</option>
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

          <div className="space-y-3 rounded-2xl border border-white/10 bg-surface-950/50 p-4">
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
                    4-digit sign-in code. Never shown in lists. Share only in person or
                    a private channel. Generating a new code ends their current sessions
                    — next sign-in must use the new code.
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
                  needsDistribution
                    ? "bg-warning-500/15 text-warning-200 ring-1 ring-warning-500/30"
                    : hasExistingCode
                      ? "bg-success-500/15 text-success-200 ring-1 ring-success-500/25"
                      : "bg-surface-800 text-surface-400 ring-1 ring-white/10",
                )}
              >
                {needsDistribution
                  ? "Share needed"
                  : hasExistingCode
                    ? "Protected"
                    : "Not set"}
              </span>
            </div>

            {credentialPin ? (
              <div className="space-y-3 rounded-xl border border-primary-500/25 bg-primary-500/10 px-3 py-3">
                <p className="text-[11px] font-medium text-primary-100/90">
                  This credential is visible only in this protected action. Copy it
                  privately, then mark it as shared.
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 items-center justify-between rounded-lg border border-white/10 bg-surface-950/80 px-3 py-2.5 font-mono text-lg tracking-[0.35em] text-surface-50">
                    <span>{showCredentialPin ? credentialPin : "••••"}</span>
                    <button
                      type="button"
                      onClick={() => setShowCredentialPin((v) => !v)}
                      className="ml-2 inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-surface-400 hover:bg-white/5 hover:text-surface-100"
                      aria-label={
                        showCredentialPin ? "Hide access code" : "Show access code"
                      }
                    >
                      {showCredentialPin ? (
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
                {needsDistribution ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    fullWidth
                    disabled={credentialBusy}
                    onClick={() => void handleAcknowledge()}
                    leftIcon={<Check className="h-3.5 w-3.5" />}
                  >
                    Mark code as shared
                  </Button>
                ) : null}
              </div>
            ) : null}

            {confirmingRotate ? (
              <div
                className="space-y-3 rounded-xl border border-warning-500/30 bg-warning-500/10 p-3"
                role="alert"
              >
                <div>
                  <p className="text-sm font-semibold text-warning-100">
                    Replace {person?.name}&apos;s access code?
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-warning-100/75">
                    Their current code stops working and all active sessions end
                    immediately.
                  </p>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={credentialBusy}
                    onClick={() => setConfirmingRotate(false)}
                  >
                    Keep current code
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    className="min-h-11"
                    disabled={credentialBusy}
                    leftIcon={
                      credentialBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )
                    }
                    onClick={() => void handleRotate()}
                  >
                    {credentialBusy ? "Replacing…" : "Replace code"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 flex-1"
                  leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                  disabled={credentialBusy}
                  onClick={() => {
                    if (hasExistingCode) setConfirmingRotate(true);
                    else void handleRotate();
                  }}
                >
                  {credentialBusy
                    ? "Working…"
                    : hasExistingCode
                      ? "Generate new code"
                      : "Generate code"}
                </Button>
                {allowPinReveal && hasExistingCode ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 flex-1"
                    disabled={credentialBusy}
                    leftIcon={<Eye className="h-3.5 w-3.5" />}
                    onClick={() => void handleReveal()}
                  >
                    Reveal current code
                  </Button>
                ) : null}
              </div>
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
                When off, this person can’t sign in. Their active sessions end
                immediately; past posts stay intact.
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
