import React, { useEffect, useRef, useState } from "react";
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
  UserCheck,
  UserRound,
} from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Select } from "./ui/Input";
import { cn } from "../utils/classNames";
import { toUiMessage } from "../utils/errorMessages";
import type {
  CredentialResult,
  Person,
  PersonRole,
  PersonUpdateFields,
} from "../services/salespeople";
import {
  BRAND_CATEGORY_OPTIONS,
  SIGNATURE_LINE_MAX_LENGTH,
  acknowledgePinDistribution,
  configureManagerLogin,
  disableManagerLogin,
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
  /** Super-admin-only manager username/password administration. */
  allowManagerLoginEdit?: boolean;
  /**
   * Dealer-admin / super-admin may grant the sales-manager permission subset
   * (spec §5). The server rejects manager_scope from any other session.
   */
  allowManagerScopeEdit?: boolean;
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
  allowManagerLoginEdit = false,
  allowManagerScopeEdit = false,
  onClose,
  onSaved,
  onCommitted,
  onCredentialIssued,
}) => {
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [role, setRole] = useState<PersonRole>("salesperson");
  const [managerScope, setManagerScope] = useState(false);
  const [signatureLine, setSignatureLine] = useState("");
  const [defaultCategory, setDefaultCategory] = useState("");
  const [playfulDefault, setPlayfulDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [credentialPin, setCredentialPin] = useState<string | null>(null);
  const [showCredentialPin, setShowCredentialPin] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasExistingCode, setHasExistingCode] = useState(false);
  const [needsDistribution, setNeedsDistribution] = useState(false);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [managerUsername, setManagerUsername] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [managerPasswordConfirm, setManagerPasswordConfirm] = useState("");
  const [showManagerPassword, setShowManagerPassword] = useState(false);
  const [managerLoginBusy, setManagerLoginBusy] = useState(false);
  const [managerUsernameError, setManagerUsernameError] = useState<string | null>(null);
  const [managerPasswordError, setManagerPasswordError] = useState<string | null>(null);
  const [managerPasswordConfirmError, setManagerPasswordConfirmError] = useState<
    string | null
  >(null);
  const [managerLoginMessage, setManagerLoginMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [confirmingDisableManagerLogin, setConfirmingDisableManagerLogin] =
    useState(false);
  const managerUsernameRef = useRef<HTMLInputElement>(null);
  const managerPasswordRef = useRef<HTMLInputElement>(null);
  const managerPasswordConfirmRef = useRef<HTMLInputElement>(null);
  const roleSelectId = React.useId();

  useEffect(() => {
    if (!person || !isOpen) return;
    setName(person.name || "");
    setActive(person.active !== false);
    setRole(person.role === "manager" ? "manager" : "salesperson");
    setManagerScope(person.managerScope === true);
    setSignatureLine(person.signatureLine || "");
    setDefaultCategory(person.defaultCategory || "");
    setPlayfulDefault(person.playfulDefault === true);
    setHasExistingCode(person.hasPin);
    setNeedsDistribution(person.pinNeedsDistribution);
    setCredentialPin(null);
    setShowCredentialPin(false);
    setCopied(false);
    setConfirmingRotate(false);
    setManagerUsername(person.managerUsername || "");
    setManagerPassword("");
    setManagerPasswordConfirm("");
    setShowManagerPassword(false);
    setManagerLoginBusy(false);
    setManagerUsernameError(null);
    setManagerPasswordError(null);
    setManagerPasswordConfirmError(null);
    setManagerLoginMessage(null);
    setConfirmingDisableManagerLogin(false);
    setError(null);
    // Reinitialize only for a newly opened account. Credential commits replace
    // the parent DTO with the same id; resetting on that object change would
    // erase the one-time success receipt and freshly issued PIN immediately.
  }, [isOpen, person?.id]);

  const showCredential = (pin: string, pinNeedsDistribution: boolean) => {
    setCredentialPin(pin);
    setShowCredentialPin(true);
    setHasExistingCode(true);
    setNeedsDistribution(pinNeedsDistribution);
    setCopied(false);
    setConfirmingRotate(false);
  };

  const handleRotate = async () => {
    if (!person?.id || credentialBusy || managerLoginBusy || saving) return;
    setCredentialBusy(true);
    setError(null);
    try {
      const result = await rotatePersonPin(person.id);
      showCredential(result.pin, result.person.pinNeedsDistribution);
      onCommitted?.(result.person);
      onCredentialIssued?.(result);
    } catch (err) {
      setError(toUiMessage(err, "Could not rotate the code."));
    } finally {
      setCredentialBusy(false);
    }
  };

  const handleAcknowledge = async () => {
    if (!person?.id || credentialBusy || managerLoginBusy || saving) return;
    setCredentialBusy(true);
    setError(null);
    try {
      const updated = await acknowledgePinDistribution(person.id);
      setNeedsDistribution(updated.pinNeedsDistribution);
      setCredentialPin(null);
      setShowCredentialPin(false);
      onCommitted?.(updated);
    } catch (err) {
      setError(toUiMessage(err, "Could not mark the code as shared."));
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

  const handleConfigureManagerLogin = async () => {
    if (
      !person?.id ||
      !allowManagerLoginEdit ||
      managerLoginBusy ||
      saving ||
      credentialBusy
    ) {
      return;
    }
    const username = managerUsername.trim().toLowerCase();
    setManagerUsernameError(null);
    setManagerPasswordError(null);
    setManagerPasswordConfirmError(null);
    setManagerLoginMessage(null);
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username)) {
      setManagerUsernameError(
        "Username must be 3 to 32 characters, start with a letter, and use only letters, numbers, periods, dashes, or underscores.",
      );
      managerUsernameRef.current?.focus();
      return;
    }
    if (managerPassword.length < 8 || managerPassword.length > 128) {
      setManagerPasswordError("Manager password must be between 8 and 128 characters.");
      managerPasswordRef.current?.focus();
      return;
    }
    if (managerPassword !== managerPasswordConfirm) {
      setManagerPasswordConfirmError("Manager passwords do not match.");
      managerPasswordConfirmRef.current?.focus();
      return;
    }
    setManagerLoginBusy(true);
    setError(null);
    try {
      const replacingExistingLogin = person.hasManagerLogin;
      const updated = await configureManagerLogin(person.id, {
        username,
        password: managerPassword,
      });
      setManagerUsername(updated.managerUsername || username);
      setManagerPassword("");
      setManagerPasswordConfirm("");
      setShowManagerPassword(false);
      setConfirmingDisableManagerLogin(false);
      setManagerLoginMessage({
        kind: "success",
        text: replacingExistingLogin
          ? "Manager login replaced. Existing manager sessions have ended."
          : "Manager login enabled. Share the credentials privately.",
      });
      onCommitted?.(updated);
    } catch (err) {
      setManagerLoginMessage({
        kind: "error",
        text: toUiMessage(err, "Could not configure manager sign-in."),
      });
    } finally {
      setManagerLoginBusy(false);
    }
  };

  const handleDisableManagerLogin = async () => {
    if (
      !person?.id ||
      !allowManagerLoginEdit ||
      managerLoginBusy ||
      saving ||
      credentialBusy
    ) {
      return;
    }
    setManagerLoginBusy(true);
    setError(null);
    setManagerLoginMessage(null);
    try {
      const updated = await disableManagerLogin(person.id);
      setManagerUsername("");
      setManagerPassword("");
      setManagerPasswordConfirm("");
      setShowManagerPassword(false);
      setConfirmingDisableManagerLogin(false);
      setManagerLoginMessage({
        kind: "success",
        text: "Manager login disabled. Existing manager sessions have ended.",
      });
      onCommitted?.(updated);
    } catch (err) {
      setManagerLoginMessage({
        kind: "error",
        text: toUiMessage(err, "Could not disable manager sign-in."),
      });
    } finally {
      setManagerLoginBusy(false);
    }
  };

  const handleSave = async () => {
    if (!person?.id || saving || managerLoginBusy || credentialBusy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    const trimmedSignatureLine = signatureLine.replace(/\s+/g, " ").trim();
    if (trimmedSignatureLine.length > SIGNATURE_LINE_MAX_LENGTH) {
      setError(
        `Signature line must be ${SIGNATURE_LINE_MAX_LENGTH} characters or fewer.`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fields: PersonUpdateFields = {
        name: trimmed,
        active,
        signatureLine: trimmedSignatureLine,
        defaultCategory,
        playfulDefault,
      };
      if (allowRoleEdit) fields.role = role;
      if (allowManagerScopeEdit) fields.managerScope = managerScope;
      const updated = await updatePerson(person.id, fields);
      onSaved({
        ...person,
        ...updated,
        name: trimmed,
        hasPin: hasExistingCode,
        pinNeedsDistribution: needsDistribution,
        active,
        role: allowRoleEdit ? role : person.role,
        managerScope: allowManagerScopeEdit ? managerScope : person.managerScope,
        signatureLine: trimmedSignatureLine,
        defaultCategory,
        playfulDefault,
      });
      onClose();
    } catch (err) {
      setError(toUiMessage(err, "Could not save profile."));
    } finally {
      setSaving(false);
    }
  };

  const effectiveRole = allowRoleEdit ? role : person?.role;
  const roleLabel = effectiveRole === "manager" ? "Manager" : "Salesperson";
  const mutationBusy = saving || credentialBusy || managerLoginBusy;
  const managerRoleCommitted = person?.role === "manager";
  const showManagerLoginEditor =
    allowManagerLoginEdit && managerRoleCommitted && effectiveRole === "manager";
  const managerPromotionPending =
    allowManagerLoginEdit && !managerRoleCommitted && effectiveRole === "manager";

  return (
    <Modal
      isOpen={isOpen && !!person}
      onClose={onClose}
      disableClose={mutationBusy}
      size="md"
      title="Account settings"
      description={storeName ? `${storeName} · secure profile` : "Secure profile"}
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={mutationBusy}
            className="min-h-12 sm:min-w-[7rem]"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={mutationBusy}
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
        <div className="relative overflow-hidden rounded-2xl border border-hairline bg-linear-to-br from-surface-800/80 to-surface-900/90 p-4">
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
                <span className="inline-flex items-center gap-1 rounded-full bg-fill-subtle px-2 py-0.5 font-medium text-surface-300">
                  {roleLabel}
                </span>
                {storeName ? <span className="truncate">{storeName}</span> : null}
              </div>
            </div>
          </div>
        </div>

        {/* Profile */}
        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-surface-400">
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
                className="w-full rounded-xl border border-surface-700 bg-surface-900/70 px-4 py-3 text-surface-50 focus:border-primary-500 focus:outline-hidden"
              >
                <option value="salesperson">Salesperson — create posts</option>
                <option value="manager">Manager — store dashboard & team</option>
              </select>
            </div>
          )}

          <Input
            label="Signature line"
            value={signatureLine}
            onChange={(e) =>
              setSignatureLine(e.target.value.slice(0, SIGNATURE_LINE_MAX_LENGTH))
            }
            maxLength={SIGNATURE_LINE_MAX_LENGTH}
            helperText={`Added after the caption footer · ${
              SIGNATURE_LINE_MAX_LENGTH - signatureLine.length
            } characters left`}
            placeholder="Ask for Taylor — happy to help your family find the right fit."
            fullWidth
            autoComplete="off"
          />

          <Select
            label="Default category"
            value={defaultCategory}
            onChange={(e) => setDefaultCategory(e.target.value)}
            helperText="Pre-selects the post category when they start a post."
            fullWidth
          >
            <option value="">Ask every time</option>
            {BRAND_CATEGORY_OPTIONS.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </Select>

          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-hairline bg-surface-950/40 px-4 py-3.5 transition-colors hover:border-strong">
            <input
              type="checkbox"
              checked={playfulDefault}
              onChange={(e) => setPlayfulDefault(e.target.checked)}
              className="h-5 w-5 rounded border-surface-600 bg-surface-900 text-primary-500 focus:ring-primary-500"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-surface-100">
                Playful default
              </span>
              <span className="block text-xs text-surface-400">
                Pre-selects the Playful second image whenever the dealership allows it.
              </span>
            </span>
          </label>

          {allowManagerScopeEdit && (
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-hairline bg-surface-950/40 px-4 py-3.5 transition-colors hover:border-strong">
              <input
                type="checkbox"
                checked={managerScope}
                onChange={(e) => setManagerScope(e.target.checked)}
                className="h-5 w-5 rounded border-surface-600 bg-surface-900 text-primary-500 focus:ring-primary-500"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-surface-100">
                  Sales manager scope
                </span>
                <span className="block text-xs text-surface-400">
                  Can approve posts, curate templates, and enable features for the team.
                  Cannot change the brand kit or compliance settings.
                </span>
              </span>
            </label>
          )}
        </section>

        {/* Security */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-primary-300" />
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-surface-400">
              Security
            </h3>
          </div>

          {managerPromotionPending ? (
            <div
              className="rounded-2xl border border-warning-400/25 bg-warning-500/8 px-4 py-3 text-sm text-warning-100 in-[.theme-light]:text-warning-900"
              role="status"
            >
              Save the manager role first. You can then reopen this account to set up
              its username and password.
            </div>
          ) : null}

          {showManagerLoginEditor ? (
            <div className="space-y-4 rounded-2xl border border-primary-400/20 bg-primary-500/6 p-4">
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-primary-500/10 ring-1 ring-primary-400/20">
                    <UserCheck className="h-4 w-4 text-primary-200" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-surface-50">
                      Manager username &amp; password
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-surface-400">
                      Opens this dealership’s manager workspace only. Saving a new
                      username or password ends all current sessions for this manager.
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
                    person?.hasManagerLogin
                      ? "bg-success-500/15 text-success-200 ring-1 ring-success-500/25 in-[.theme-light]:text-success-800"
                      : "bg-surface-800 text-surface-400 ring-1 ring-hairline",
                  )}
                >
                  {person?.hasManagerLogin ? "Enabled" : "Not set"}
                </span>
              </div>

              <Input
                ref={managerUsernameRef}
                label="Manager username"
                name="manager-username"
                value={managerUsername}
                onChange={(event) => {
                  setError(null);
                  setManagerUsernameError(null);
                  setManagerLoginMessage(null);
                  setManagerUsername(event.target.value.slice(0, 32));
                }}
                disabled={mutationBusy}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={32}
                error={managerUsernameError || undefined}
                helperText="3–32 characters · starts with a letter"
                fullWidth
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  ref={managerPasswordRef}
                  label={person?.hasManagerLogin ? "New password" : "Password"}
                  name="new-manager-password"
                  value={managerPassword}
                  type={showManagerPassword ? "text" : "password"}
                  onChange={(event) => {
                    setError(null);
                    setManagerPasswordError(null);
                    setManagerPasswordConfirmError(null);
                    setManagerLoginMessage(null);
                    setManagerPassword(event.target.value.slice(0, 128));
                  }}
                  disabled={mutationBusy}
                  rightAction={
                    <button
                      type="button"
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-surface-400 transition hover:bg-fill-subtle hover:text-surface-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-400"
                      onClick={() => setShowManagerPassword((value) => !value)}
                      aria-label={
                        showManagerPassword
                          ? "Hide new manager password"
                          : "Show new manager password"
                      }
                    >
                      {showManagerPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  }
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  minLength={8}
                  maxLength={128}
                  error={managerPasswordError || undefined}
                  helperText="8 characters minimum; spaces are allowed"
                  fullWidth
                />
                <Input
                  ref={managerPasswordConfirmRef}
                  label="Confirm password"
                  name="confirm-manager-password"
                  value={managerPasswordConfirm}
                  type={showManagerPassword ? "text" : "password"}
                  onChange={(event) => {
                    setError(null);
                    setManagerPasswordConfirmError(null);
                    setManagerLoginMessage(null);
                    setManagerPasswordConfirm(event.target.value.slice(0, 128));
                  }}
                  disabled={mutationBusy}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  minLength={8}
                  maxLength={128}
                  error={managerPasswordConfirmError || undefined}
                  fullWidth
                />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="min-h-11 flex-1"
                  disabled={mutationBusy}
                  leftIcon={
                    managerLoginBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )
                  }
                  onClick={() => void handleConfigureManagerLogin()}
                >
                  {managerLoginBusy
                    ? "Saving…"
                    : person?.hasManagerLogin
                      ? "Replace manager login"
                      : "Enable manager login"}
                </Button>
                {person?.hasManagerLogin ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={mutationBusy}
                    onClick={() => setConfirmingDisableManagerLogin(true)}
                  >
                    Disable
                  </Button>
                ) : null}
              </div>

              {managerLoginMessage ? (
                <p
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-xs",
                    managerLoginMessage.kind === "success"
                      ? "border-success-500/25 bg-success-500/10 text-success-100 in-[.theme-light]:text-success-900"
                      : "border-error-700/40 bg-error-900/30 text-error-100 in-[.theme-light]:text-error-800",
                  )}
                  role={managerLoginMessage.kind === "error" ? "alert" : "status"}
                  aria-live="polite"
                >
                  {managerLoginMessage.text}
                </p>
              ) : null}

              {confirmingDisableManagerLogin ? (
                <div
                  className="space-y-3 rounded-xl border border-warning-500/30 bg-warning-500/10 p-3"
                  role="alert"
                >
                  <p className="text-sm font-semibold text-warning-100">
                    Disable username and password sign-in?
                  </p>
                  <p className="text-xs leading-relaxed text-warning-100/75">
                    Current sessions end immediately. Their 4-digit fallback code
                    remains available during the compatibility period.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={mutationBusy}
                      onClick={() => setConfirmingDisableManagerLogin(false)}
                    >
                      Keep enabled
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      className="min-h-11"
                      disabled={mutationBusy}
                      onClick={() => void handleDisableManagerLogin()}
                    >
                      Disable manager login
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-3 rounded-2xl border border-hairline bg-surface-950/50 p-4">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-fill-subtle ring-1 ring-hairline">
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
                    ? "bg-warning-500/15 text-warning-200 ring-1 ring-warning-500/30 in-[.theme-light]:text-warning-800"
                    : hasExistingCode
                      ? "bg-success-500/15 text-success-200 ring-1 ring-success-500/25 in-[.theme-light]:text-success-800"
                      : "bg-surface-800 text-surface-400 ring-1 ring-hairline",
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
                  <div className="flex flex-1 items-center justify-between rounded-lg border border-hairline bg-surface-950/80 px-3 py-2.5 font-mono text-lg tracking-[0.35em] text-surface-50">
                    <span>{showCredentialPin ? credentialPin : "••••"}</span>
                    <button
                      type="button"
                      onClick={() => setShowCredentialPin((v) => !v)}
                      className="ml-2 inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-surface-400 hover:bg-fill-subtle hover:text-surface-100"
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
                    disabled={mutationBusy}
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
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={mutationBusy}
                    onClick={() => setConfirmingRotate(false)}
                  >
                    Keep current code
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    className="min-h-11"
                    disabled={mutationBusy}
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
                  disabled={mutationBusy}
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
                  <p className="flex-1 self-center text-xs text-surface-400">
                    Codes are stored securely and can't be shown again — generate a new
                    one if it was lost.
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-hairline bg-surface-950/40 px-4 py-3.5 transition-colors hover:border-strong">
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
              <span className="block text-xs text-surface-400">
                When off, this person can’t sign in. Their active sessions end
                immediately; past posts stay intact.
              </span>
            </span>
          </label>
        </section>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-error-700/40 bg-error-900/30 px-3 py-2.5 text-xs text-error-100 in-[.theme-light]:text-error-800"
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};
