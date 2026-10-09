import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  KeyRound,
  RefreshCw,
  TestTube2,
} from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { cn } from "../../utils/classNames";
import { Button } from "../ui/Button";
import { SystemHealthPanel } from "../SystemHealthPanel";
import { ApiError } from "../../services/apiErrors";
import {
  getConnections,
  getConnectionProofs,
  saveConnection,
  testConnection,
  type ConnectionServiceId,
  type ConnectionsResponse,
  type ManagedConnection,
} from "../../services/connections";

export const SYSTEM_CONNECTIONS_QUERY_KEY = "system-connections";

type Field = {
  key: string;
  label: string;
  type?: "text" | "url";
  help?: string;
  advanced?: boolean;
};

type ServiceInfo = {
  id: ConnectionServiceId;
  title: string;
  description: string;
  optional?: boolean;
  scope: "global" | "dealer";
  credentialFields: Field[];
  settingFields: Field[];
  advancedFields?: Field[];
  advancedCredentialFields?: Field[];
  proofLabel?: string;
  proofHelp?: string;
  help: string;
};

const SERVICES: ServiceInfo[] = [
  {
    id: "gemini",
    title: "Google Gemini",
    description: "AI generation for captions, images, and video.",
    scope: "global",
    credentialFields: [{ key: "apiKey", label: "Gemini API key" }],
    settingFields: [],
    help: "This connection is managed centrally and shared by dealerships.",
  },
  {
    id: "anthropic",
    title: "Anthropic fallback",
    description: "Optional backup for supported text tasks.",
    optional: true,
    scope: "global",
    credentialFields: [{ key: "apiKey", label: "Anthropic API key" }],
    settingFields: [],
    help: "The model policy chooses eligible fallback tasks. This can stay off.",
  },
  {
    id: "openai",
    title: "OpenAI fallback",
    description: "Optional backup for supported text tasks.",
    optional: true,
    scope: "global",
    credentialFields: [{ key: "apiKey", label: "OpenAI API key" }],
    settingFields: [],
    help: "The model policy chooses eligible fallback tasks. This can stay off.",
  },
  {
    id: "website",
    title: "Customer website drafts",
    description: "Send private post drafts to a dealership website for review.",
    optional: true,
    scope: "dealer",
    credentialFields: [{ key: "sharedSecret", label: "Website connection key" }],
    settingFields: [
      { key: "origin", label: "Approved website address", type: "url" },
      { key: "destinationId", label: "Website destination ID" },
    ],
    proofLabel: "Released post ID for private test",
    proofHelp: "The test sends a private draft. It will not publish publicly.",
    help: "Choose the dealership this website belongs to. Only approved destinations can be used.",
  },
  {
    id: "walkaround",
    title: "Walkaround video service",
    description: "Private uploads, video processing, and YouTube delivery.",
    optional: true,
    scope: "global",
    credentialFields: [],
    settingFields: [],
    advancedFields: [
      { key: "gcsBucket", label: "Private storage bucket" },
      { key: "uploadBrokerUrl", label: "Upload service address", type: "url" },
      { key: "youtubeBrokerUrl", label: "YouTube service address", type: "url" },
    ],
    advancedCredentialFields: [
      { key: "uploadBrokerToken", label: "Upload service token" },
      { key: "youtubeBrokerToken", label: "YouTube service token" },
      { key: "workerToken", label: "Video worker token" },
      { key: "workerSigningSecret", label: "Worker signing secret" },
    ],
    proofLabel: "Completed private project ID",
    proofHelp: "Testing checks an existing complete project; it does not publish it.",
    help: "Shared storage and processing are centrally managed. Dealerships connect their own YouTube accounts in Settings.",
  },
];

const statusLabel: Record<ManagedConnection["state"], string> = {
  off: "Off",
  needs_setup: "Needs setup",
  needs_test: "Test required",
  testing: "Testing",
  ready: "Ready",
  attention: "Needs attention",
};

const emptyCredentials = (): Record<string, string> => ({});

const initialSettings = (connection?: ManagedConnection) => ({
  ...(connection?.settings ?? {}),
  enabled: connection?.enabled ?? false,
});

const inputClass =
  "min-h-11 w-full rounded-sm border border-strong bg-panel-raised px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-none";

function ServiceCard({
  service,
  connections,
  dealers,
  secureStorageAvailable,
  onRefresh,
  onManageDealer,
  onOpenWalkaround,
}: {
  service: ServiceInfo;
  connections: ManagedConnection[];
  dealers: ConnectionsResponse["dealers"];
  secureStorageAvailable: boolean;
  onRefresh: () => Promise<unknown>;
  onManageDealer?: (dealerId: string) => void;
  onOpenWalkaround?: (dealerId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [settings, setSettings] = useState<
    Record<string, string | boolean | undefined>
  >(() => initialSettings(connections[0]));
  const [credentials, setCredentials] =
    useState<Record<string, string>>(emptyCredentials);
  const [dealerId, setDealerId] = useState(
    connections.find((item) => item.dealerId)?.dealerId ?? "",
  );
  const [proofId, setProofId] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const currentAuthEpoch = useAppStore((state) => state.authEpoch);
  const testAttemptRef = useRef<{ identity: string; idempotencyKey: string } | null>(
    null,
  );
  const clearSetup = () => {
    forgetCredentials();
    setProofId("");
    setError("");
    setNotice("");
  };

  const connection =
    service.scope === "dealer"
      ? connections.find((item) => item.dealerId === dealerId)
      : connections[0];
  useEffect(() => {
    setSettings(initialSettings(connection));
  }, [connection]);
  useEffect(() => {
    setProofId("");
    setCredentials(emptyCredentials());
    setError("");
    setNotice("");
    testAttemptRef.current = null;
  }, [dealerId]);
  useEffect(() => {
    testAttemptRef.current = null;
  }, [connection?.revision]);
  useEffect(() => {
    testAttemptRef.current = null;
  }, [proofId]);
  const proofQuery = useQuery({
    queryKey: ["connection-test-proofs", service.id, dealerId, currentAuthEpoch],
    enabled:
      open &&
      Boolean(service.proofLabel) &&
      (service.scope !== "dealer" || Boolean(dealerId)) &&
      (service.id !== "walkaround" || Boolean(dealerId)),
    queryFn: ({ signal }) =>
      getConnectionProofs(
        service.id as "website" | "walkaround",
        dealerId || undefined,
        signal,
      ),
    staleTime: 0,
  });
  useEffect(() => () => setCredentials(emptyCredentials()), []);
  useEffect(() => {
    setCredentials(emptyCredentials());
    setProofId("");
    testAttemptRef.current = null;
    setBusy(null);
    setError("");
    setNotice("");
  }, [currentAuthEpoch]);

  const forgetCredentials = () => setCredentials(emptyCredentials());
  const updateSetting = (key: string, value: string | boolean) =>
    setSettings((previous) => ({ ...previous, [key]: value }));
  const updateCredential = (key: string, value: string) =>
    setCredentials((previous) => ({ ...previous, [key]: value }));
  const ready = connection?.state === "ready";
  const currentState = connection?.state ?? "needs_setup";
  const cardStatus =
    service.id === "gemini" && ready
      ? "Caption access verified"
      : statusLabel[currentState];
  const optionalOff = Boolean(service.optional && connection?.state === "off");
  const dealerLabel = dealers.find((dealer) => dealer.id === dealerId)?.name;

  const save = async () => {
    if (!connection) return;
    const requestAuthEpoch = currentAuthEpoch;
    setBusy("save");
    setError("");
    setNotice("");
    try {
      await saveConnection(service.id, {
        ...(service.scope === "dealer" ? { dealerId } : {}),
        expectedRevision: connection.revision,
        enabled: service.optional ? Boolean(settings.enabled) : true,
        settings: Object.fromEntries(
          Object.entries(settings).filter(
            ([key, value]) => key !== "enabled" && value !== undefined,
          ),
        ) as Record<string, string | boolean>,
        credentials: Object.fromEntries(
          Object.entries(credentials).filter(([, value]) => value.trim().length > 0),
        ),
      });
      if (useAppStore.getState().authEpoch !== requestAuthEpoch) return;
      forgetCredentials();
      setNotice("Saved. Run a test before relying on this connection.");
      await onRefresh();
    } catch (cause) {
      if (useAppStore.getState().authEpoch !== requestAuthEpoch) return;
      setError(
        cause instanceof Error ? cause.message : "Could not save this connection.",
      );
    } finally {
      if (useAppStore.getState().authEpoch === requestAuthEpoch) {
        forgetCredentials();
        setBusy(null);
      }
    }
  };

  const runTest = async () => {
    if (!connection) return;
    const requestAuthEpoch = currentAuthEpoch;
    const proof = proofId.trim();
    const attemptIdentity = JSON.stringify([
      service.id,
      service.scope === "dealer" || service.id === "walkaround" ? dealerId : "",
      connection.revision,
      proof,
      requestAuthEpoch,
    ]);
    const attempt = testAttemptRef.current;
    const idempotencyKey =
      attempt?.identity === attemptIdentity
        ? attempt.idempotencyKey
        : (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    testAttemptRef.current = { identity: attemptIdentity, idempotencyKey };
    setBusy("test");
    setError("");
    setNotice("");
    try {
      const result = await testConnection(service.id, {
        ...(service.scope === "dealer" || service.id === "walkaround"
          ? { dealerId }
          : {}),
        expectedRevision: connection.revision,
        idempotencyKey,
        ...(service.proofLabel ? { proofId: proof } : {}),
      });
      const outcomeIsAmbiguous =
        result.state === "testing" || result.errorCode === "CONNECTION_TEST_UNKNOWN";
      if (
        !outcomeIsAmbiguous &&
        testAttemptRef.current?.idempotencyKey === idempotencyKey
      ) {
        testAttemptRef.current = null;
      }
      if (useAppStore.getState().authEpoch !== requestAuthEpoch) return;
      setNotice(
        "Test submitted. The status will show Ready only after verification completes.",
      );
      await onRefresh();
    } catch (cause) {
      if (useAppStore.getState().authEpoch !== requestAuthEpoch) return;
      if (
        cause instanceof ApiError &&
        cause.status < 500 &&
        testAttemptRef.current?.idempotencyKey === idempotencyKey
      ) {
        testAttemptRef.current = null;
      }
      setError(cause instanceof Error ? cause.message : "The connection test failed.");
      await onRefresh();
    } finally {
      if (useAppStore.getState().authEpoch === requestAuthEpoch) setBusy(null);
    }
  };

  const fields = service.settingFields;
  const statusTone =
    currentState === "ready"
      ? "border-success-ink/40 bg-success-fill text-success-ink"
      : currentState === "off" && service.optional
        ? "border-hairline bg-panel text-ink-2"
        : currentState === "testing"
          ? "border-brand-ink/30 bg-brand-tint text-ink"
          : "border-warning-ink/30 bg-warning-fill text-warning-ink";

  return (
    <article
      aria-labelledby={`connection-${service.id}-title`}
      className="rounded-md border border-hairline bg-panel px-4 py-4 sm:px-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={`connection-${service.id}-title`}
              className="text-base font-semibold text-ink"
            >
              {service.title}
            </h3>
            <span
              className={cn(
                "rounded-sm border px-2 py-0.5 text-xs font-semibold",
                statusTone,
              )}
            >
              {cardStatus}
            </span>
            {service.optional ? (
              <span className="text-xs text-ink-2">Optional</span>
            ) : null}
          </div>
          <p className="text-sm text-ink-2">{service.description}</p>
          <p className="text-sm text-ink-2">{service.help}</p>
          {service.scope === "dealer" && dealerLabel ? (
            <p className="text-sm font-medium text-ink">For {dealerLabel}</p>
          ) : null}
          {connection?.lastVerifiedAt && ready ? (
            <p className="text-xs text-ink-2">
              Verified {new Date(connection.lastVerifiedAt).toLocaleString()}
            </p>
          ) : null}
          {connection?.nextAction ? (
            <p className="text-sm text-ink">Next: {connection.nextAction}</p>
          ) : null}
          {service.id === "website" &&
          connection?.errorCode === "CONNECTION_DRAFT_PENDING" ? (
            <p className="text-sm text-ink-2" role="status">
              Draft delivery is still pending. Test this same saved draft again to
              confirm receipt.
            </p>
          ) : null}
          {connection?.capabilities.length ? (
            <ul
              className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2"
              aria-label={`${service.title} capability verification`}
            >
              {connection.capabilities.map((capability) => (
                <li key={capability.id}>
                  {capability.label}:{" "}
                  {capability.state === "verified" ? "Verified" : "Not tested"}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<KeyRound />}
            aria-expanded={open}
            onClick={() => {
              if (open) clearSetup();
              setOpen((value) => !value);
            }}
          >
            {ready ? "Manage" : "Set up"}
          </Button>
          <Button
            variant={ready ? "ghost" : "primary"}
            size="sm"
            leftIcon={<TestTube2 />}
            disabled={
              !connection ||
              busy !== null ||
              ((service.scope === "dealer" || service.id === "walkaround") &&
                !dealerId) ||
              Boolean(service.proofLabel && !proofId.trim())
            }
            loading={busy === "test"}
            onClick={() => void runTest()}
          >
            Test
          </Button>
        </div>
      </div>

      {open ? (
        <section
          className="mt-4 border-t border-hairline pt-4"
          aria-label={`${service.title} setup`}
        >
          {!secureStorageAvailable ? (
            <div
              className="mb-4 flex gap-2 rounded-sm border border-warning-ink/30 bg-warning-fill p-3 text-sm text-warning-ink"
              role="alert"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Secure credential storage is not available. Ask the system administrator
                to configure the encrypted connection vault in Advanced setup before
                adding keys.
              </span>
            </div>
          ) : null}
          {service.scope === "dealer" || service.id === "walkaround" ? (
            <label className="mb-4 block max-w-xl space-y-1.5 text-sm font-medium text-ink">
              {service.scope === "dealer"
                ? "Dealership"
                : "Manage a dealership's YouTube account"}
              <select
                className={inputClass}
                value={dealerId}
                disabled={busy !== null}
                onChange={(event) => setDealerId(event.target.value)}
              >
                <option value="">Choose a dealership</option>
                {dealers.map((dealer) => (
                  <option key={dealer.id} value={dealer.id}>
                    {dealer.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {service.optional ? (
            <label className="mb-4 flex min-h-11 items-center gap-3 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={Boolean(settings.enabled)}
                onChange={(event) => updateSetting("enabled", event.target.checked)}
                className="h-4 w-4 accent-brand-fill"
              />
              Turn on this optional fallback
            </label>
          ) : null}

          {fields.map((field) => (
            <label
              key={field.key}
              className="mb-4 block max-w-xl space-y-1.5 text-sm font-medium text-ink"
            >
              {field.label}
              <input
                className={inputClass}
                type={field.type ?? "text"}
                aria-label={field.label}
                value={String(settings[field.key] ?? "")}
                onChange={(event) => updateSetting(field.key, event.target.value)}
                autoComplete="off"
              />
              {field.help ? (
                <span className="block text-xs font-normal text-ink-2">
                  {field.help}
                </span>
              ) : null}
            </label>
          ))}
          {service.advancedFields?.length ? (
            <details
              className="mb-4 max-w-2xl rounded-sm border border-hairline px-3"
              onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            >
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
                <CircleHelp className="h-4 w-4" aria-hidden="true" />
                Advanced technical details
              </summary>
              <div className="pb-3 text-xs text-ink-2">
                These shared infrastructure settings are managed centrally. Ask the
                system administrator if they need to change.
              </div>
              {advancedOpen ? (
                <div>
                  {service.advancedFields.map((field) => (
                    <label
                      key={field.key}
                      className="mb-4 block max-w-xl space-y-1.5 text-sm font-medium text-ink"
                    >
                      {field.label}
                      <input
                        className={inputClass}
                        type={field.type ?? "text"}
                        aria-label={field.label}
                        value={String(settings[field.key] ?? "")}
                        onChange={(event) =>
                          updateSetting(field.key, event.target.value)
                        }
                        autoComplete="off"
                      />
                    </label>
                  ))}
                  {service.advancedCredentialFields?.map((field) => (
                    <label
                      key={field.key}
                      className="mb-4 block max-w-xl space-y-1.5 text-sm font-medium text-ink"
                    >
                      {field.label}
                      <input
                        className={inputClass}
                        type="password"
                        aria-label={field.label}
                        value={credentials[field.key] ?? ""}
                        onChange={(event) =>
                          updateCredential(field.key, event.target.value)
                        }
                        autoComplete="new-password"
                        spellCheck={false}
                        disabled={!secureStorageAvailable}
                      />
                      <span className="block text-xs font-normal text-ink-2">
                        Leave blank to keep the saved value.
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </details>
          ) : null}
          {service.credentialFields.map((field) => (
            <label
              key={field.key}
              className="mb-4 block max-w-xl space-y-1.5 text-sm font-medium text-ink"
            >
              {field.label}
              <input
                className={inputClass}
                type="password"
                aria-label={field.label}
                value={credentials[field.key] ?? ""}
                onChange={(event) => updateCredential(field.key, event.target.value)}
                autoComplete="new-password"
                spellCheck={false}
                disabled={!secureStorageAvailable}
              />
              <span className="block text-xs font-normal text-ink-2">
                Leave blank to keep the saved key. Credentials are sent securely and
                never displayed again.
              </span>
            </label>
          ))}
          {service.proofLabel ? (
            <label className="mb-4 block max-w-xl space-y-1.5 text-sm font-medium text-ink">
              {service.proofLabel}
              <select
                className={inputClass}
                aria-label={service.proofLabel}
                value={proofId}
                onChange={(event) => setProofId(event.target.value)}
                disabled={proofQuery.isPending || !proofQuery.data?.length}
              >
                <option value="">
                  {proofQuery.isPending
                    ? "Loading available proofs…"
                    : "Choose a completed proof"}
                </option>
                {(proofQuery.data ?? []).map((proof) => (
                  <option key={proof.id} value={proof.id}>
                    {proof.label}
                  </option>
                ))}
              </select>
              {proofQuery.error ? (
                <span role="alert" className="block text-xs text-error-ink">
                  Could not load available test proofs.
                </span>
              ) : null}
              {!proofQuery.isPending &&
              !proofQuery.error &&
              !proofQuery.data?.length ? (
                <span className="block text-xs text-ink-2">
                  No eligible completed proof is available yet.
                </span>
              ) : null}
              {service.proofHelp ? (
                <span className="block text-xs font-normal text-ink-2">
                  {service.proofHelp}
                </span>
              ) : null}
            </label>
          ) : null}

          {service.id === "gemini" ? (
            <p className="mb-4 max-w-xl text-xs text-ink-2">
              This check covers text generation only. Image and video capabilities
              remain unverified until their own tests pass.
            </p>
          ) : null}

          <p className="mb-3 max-w-2xl text-xs text-ink-2">
            Saving changes requires a new test. Pending deliveries pause if the
            destination changes.
          </p>
          {error ? (
            <p role="alert" className="mb-3 text-sm text-error-ink">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="mb-3 text-sm text-ink">
              {notice}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              loading={busy === "save"}
              disabled={
                !connection ||
                busy !== null ||
                (!secureStorageAvailable && service.credentialFields.length > 0)
              }
              onClick={() => void save()}
            >
              Save connection
            </Button>
            <Button
              variant="secondary"
              size="md"
              disabled={
                !connection ||
                busy !== null ||
                ((service.scope === "dealer" || service.id === "walkaround") &&
                  !dealerId) ||
                Boolean(service.proofLabel && !proofId.trim())
              }
              loading={busy === "test"}
              leftIcon={<TestTube2 />}
              onClick={() => void runTest()}
            >
              Test connection
            </Button>
            {service.scope === "dealer" && onManageDealer ? (
              <Button
                variant="ghost"
                size="md"
                disabled={!dealerId}
                leftIcon={<ExternalLink />}
                onClick={() => dealerId && onManageDealer?.(dealerId)}
              >
                Manage dealer accounts
              </Button>
            ) : null}
            {service.id === "walkaround" && onOpenWalkaround ? (
              <Button
                variant="secondary"
                size="md"
                disabled={!dealerId || !connection?.enabled || !connection.configured}
                leftIcon={<ExternalLink />}
                onClick={() => dealerId && onOpenWalkaround?.(dealerId)}
              >
                Open dealership video studio
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setOpen(false);
                clearSetup();
              }}
            >
              Close
            </Button>
          </div>
        </section>
      ) : null}
      {optionalOff ? (
        <p className="mt-3 text-xs text-ink-2">
          This optional service is off by choice.
        </p>
      ) : null}
    </article>
  );
}

export const ConnectionsPanel: React.FC<{
  onCheckAgain?: () => void;
  onManageDealer?: (dealerId: string) => void;
  onOpenWalkaround?: (dealerId: string) => void;
  dealers?: ConnectionsResponse["dealers"];
}> = ({ onCheckAgain, onManageDealer, onOpenWalkaround, dealers: fallbackDealers }) => {
  const role = useAppStore((state) => state.role);
  const authEpoch = useAppStore((state) => state.authEpoch);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [SYSTEM_CONNECTIONS_QUERY_KEY, authEpoch],
    enabled: role === "super_admin",
    staleTime: 0,
    queryFn: ({ signal }) => getConnections(signal),
  });
  const data = query.data;
  const dealerOptions = data?.dealers?.length ? data.dealers : (fallbackDealers ?? []);
  const serviceMap = useMemo(
    () =>
      (data?.services ?? []).reduce<Map<ConnectionServiceId, ManagedConnection[]>>(
        (map, connection) => {
          map.set(connection.service, [
            ...(map.get(connection.service) ?? []),
            connection,
          ]);
          return map;
        },
        new Map(),
      ),
    [data?.services],
  );

  if (role !== "super_admin") return null;
  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: [SYSTEM_CONNECTIONS_QUERY_KEY, authEpoch],
    });
    await query.refetch();
  };
  const configuredOptional = SERVICES.filter((service) => service.optional).filter(
    (service) =>
      service.id !== "website" &&
      serviceMap.get(service.id)?.some((connection) => connection.state !== "off"),
  );
  const required = [
    ...SERVICES.filter((service) => !service.optional),
    ...configuredOptional,
  ];
  const readyCount = required.filter((service) => {
    const rows = serviceMap.get(service.id) ?? [];
    return rows.some((connection) => connection.state === "ready");
  }).length;
  const allReady = required.length > 0 && readyCount === required.length;

  return (
    <div className="flex flex-wrap items-start gap-x-12 gap-y-8">
      <main className="flex min-w-0 flex-[999_1_34rem] flex-col gap-6">
        <header className="space-y-2">
          <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">
            Connections
          </h2>
          <p className="max-w-3xl text-sm text-ink-2 md:text-base">
            Set up shared AI and video services here. Website drafts are configured for
            one dealership at a time; dealerships connect their own social accounts in
            Settings.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
            <span>AI and video infrastructure: centrally managed</span>
            <span>Website destination: dealership-specific</span>
            <span>Social accounts: dealership-managed</span>
          </div>
        </header>

        {query.isPending ? (
          <p role="status" className="text-sm text-ink-2">
            Loading connections…
          </p>
        ) : null}
        {query.error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-error-ink/30 bg-error-fill p-4 text-sm text-error-ink"
          >
            <span>{query.error.message}</span>
            <Button
              variant="secondary"
              loading={query.isFetching}
              leftIcon={<RefreshCw />}
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {data ? (
          <>
            {!data.secureStorageAvailable ? (
              <p
                className="rounded-sm border border-warning-ink/30 bg-warning-fill p-3 text-sm text-warning-ink"
                role="status"
              >
                Secure credential storage is not ready. Existing settings remain
                visible, but new credentials cannot be saved. See Advanced setup for the
                administrator action required.
              </p>
            ) : null}
            <section aria-labelledby="shared-connections-heading" className="space-y-3">
              <h3
                id="shared-connections-heading"
                className="font-display text-xl font-semibold text-ink"
              >
                Shared services
              </h3>
              {SERVICES.filter((service) => service.scope === "global").map(
                (service) => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    connections={serviceMap.get(service.id) ?? []}
                    dealers={dealerOptions}
                    secureStorageAvailable={Boolean(data.secureStorageAvailable)}
                    onRefresh={refresh}
                    onManageDealer={onManageDealer}
                    onOpenWalkaround={onOpenWalkaround}
                  />
                ),
              )}
            </section>
            <section aria-labelledby="dealer-connections-heading" className="space-y-3">
              <h3
                id="dealer-connections-heading"
                className="font-display text-xl font-semibold text-ink"
              >
                Dealership connections
              </h3>
              <p className="text-sm text-ink-2">
                Choose the dealership whose approved website will receive private
                drafts.
              </p>
              <ServiceCard
                service={SERVICES.find((service) => service.id === "website")!}
                connections={serviceMap.get("website") ?? []}
                dealers={dealerOptions}
                secureStorageAvailable={Boolean(data.secureStorageAvailable)}
                onRefresh={refresh}
                onManageDealer={onManageDealer}
                onOpenWalkaround={onOpenWalkaround}
              />
            </section>
            {allReady ? (
              <p
                className="flex items-center gap-2 text-sm font-medium text-ink"
                role="status"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                All required connection checks passed. Capability details appear on each
                service.
              </p>
            ) : (
              <p className="text-sm text-ink-2" role="status">
                {readyCount} of {required.length} required connection checks verified. A
                saved configuration alone does not count as Ready.
              </p>
            )}
            <section aria-labelledby="runtime-health-heading" className="space-y-3">
              <div>
                <h3
                  id="runtime-health-heading"
                  className="font-display text-xl font-semibold text-ink"
                >
                  Runtime health
                </h3>
                <p className="text-sm text-ink-2">
                  Live service health and recovery information.
                </p>
              </div>
              <SystemHealthPanel />
            </section>
            <details className="border-y border-hairline">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 py-3 text-sm font-semibold text-ink">
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
                Advanced technical details
              </summary>
              <dl className="grid gap-3 border-t border-hairline py-4 text-sm sm:grid-cols-2">
                {data.apiContractVersion ? (
                  <div>
                    <dt className="text-ink-2">API contract</dt>
                    <dd className="font-mono text-ink">{data.apiContractVersion}</dd>
                  </div>
                ) : null}
                {data.modelPolicyVersion ? (
                  <div>
                    <dt className="text-ink-2">Model policy</dt>
                    <dd className="text-ink">{data.modelPolicyVersion}</dd>
                  </div>
                ) : null}
                {Object.entries(data.capabilities ?? {}).map(([name, enabled]) => (
                  <div key={name}>
                    <dt className="text-ink-2">{name}</dt>
                    <dd className="text-ink">
                      {enabled ? "Available" : "Unavailable"}
                    </dd>
                  </div>
                ))}
                <div>
                  <dt className="text-ink-2">Encrypted credential storage</dt>
                  <dd className="text-ink">
                    {data.secureStorageAvailable
                      ? "Available"
                      : "Needs administrator setup"}
                  </dd>
                </div>
              </dl>
            </details>
          </>
        ) : null}
      </main>
      <aside
        aria-label="Connection readiness"
        className="flex w-full flex-col gap-3 border-t border-hairline pt-4 md:max-w-[20rem] md:flex-[1_1_16rem] md:border-0 md:pt-1"
      >
        <h3 className="text-base font-semibold text-ink">Verification status</h3>
        <p className="text-sm text-ink-2">
          {query.isPending
            ? "Checking verified service status…"
            : data
              ? `${readyCount} of ${required.length} required services verified.`
              : "Connection status unavailable."}
        </p>
        <Button
          variant="secondary"
          leftIcon={<RefreshCw />}
          loading={query.isFetching}
          onClick={() => {
            if (onCheckAgain) onCheckAgain();
            else void refresh();
          }}
        >
          Refresh status
        </Button>
        <p className="text-xs text-ink-2">
          A connection is Ready only after its server-side test succeeds. Optional
          services that are off do not count as faults.
        </p>
      </aside>
    </div>
  );
};
