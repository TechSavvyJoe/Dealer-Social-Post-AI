import React, { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "../ui/Button";
import { YouTubeConnectionCard } from "../YouTubeConnectionCard";
import { toUiMessage } from "../../utils/errorMessages";
import {
  getConnectionProofs,
  testConnection,
  type ConnectionCapability,
  type ConnectionProofOption,
} from "../../services/connections";
import { useAppStore } from "../../stores/appStore";
import { readApiError } from "../../services/apiErrors";
import { assertAuthEpoch, captureAuthEpoch } from "../../utils/authBoundary";
import {
  listWebsiteDestinations,
  type WebsiteDestination,
} from "../../services/websitePublishing";
import { DoneMark, ErrorNote, ServiceRow, SettingsGroup } from "./SettingsRows";

interface DealerWebsiteConnection {
  service: "website";
  enabled: boolean;
  configured: boolean;
  revision: number;
  state: "off" | "needs_setup" | "needs_test" | "testing" | "ready" | "attention";
  capabilities: ConnectionCapability[];
}

const getDealerWebsiteConnection = async (signal: AbortSignal) => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const response = await fetch("/api/app/dealer-connections", {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await readApiError(response, { requestAuthEpoch });
  const payload = (await response.json()) as { services?: DealerWebsiteConnection[] };
  assertAuthEpoch(requestAuthEpoch);
  return payload.services?.find((service) => service.service === "website") || null;
};

/**
 * The store's private website draft route, as one row. Same states and
 * actions as before (checking, error with Retry, connected with a link to the
 * site, not configured); only the chrome changed.
 */
const WebsiteConnectionRow: React.FC = () => {
  const [destinations, setDestinations] = useState<WebsiteDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(0);
  const [connection, setConnection] = useState<DealerWebsiteConnection | null>(null);
  const [proofs, setProofs] = useState<ConnectionProofOption[]>([]);
  const [proofId, setProofId] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const testAttempt = React.useRef<{ scope: string; key: string } | null>(null);
  const testRunId = React.useRef(0);
  const dealerId = useAppStore((state) => state.currentDealer?.id);
  const authEpoch = useAppStore((state) => state.authEpoch);

  useEffect(() => {
    setTesting(false);
    setTestMessage(null);
    setTestError(null);
    setProofId("");
    testAttempt.current = null;
  }, [authEpoch, dealerId]);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    const requestAuthEpoch = authEpoch;
    const requestDealerId = dealerId;
    setLoading(true);
    setError(null);
    setConnection(null);
    setDestinations([]);
    setProofId("");
    void Promise.all([
      listWebsiteDestinations(controller.signal),
      getDealerWebsiteConnection(controller.signal),
    ])
      .then(([items, managed]) => {
        if (
          !live ||
          useAppStore.getState().authEpoch !== requestAuthEpoch ||
          useAppStore.getState().currentDealer?.id !== requestDealerId
        )
          return;
        setDestinations(items);
        setConnection(managed);
      })
      .catch((err) => {
        if (
          !live ||
          useAppStore.getState().authEpoch !== requestAuthEpoch ||
          useAppStore.getState().currentDealer?.id !== requestDealerId
        )
          return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(toUiMessage(err, "Could not check the private website connection."));
      })
      .finally(() => {
        if (
          live &&
          !controller.signal.aborted &&
          useAppStore.getState().authEpoch === requestAuthEpoch &&
          useAppStore.getState().currentDealer?.id === requestDealerId
        )
          setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [requestKey, authEpoch, dealerId]);

  useEffect(() => {
    if (
      !dealerId ||
      !connection?.configured ||
      !connection.enabled ||
      connection.capabilities.some(
        (capability) => capability.id === "website" && capability.state === "verified",
      )
    ) {
      setProofs([]);
      return;
    }
    const controller = new AbortController();
    let live = true;
    const requestAuthEpoch = authEpoch;
    void getConnectionProofs("website", dealerId, controller.signal)
      .then((items) => {
        if (
          !live ||
          useAppStore.getState().authEpoch !== requestAuthEpoch ||
          useAppStore.getState().currentDealer?.id !== dealerId
        )
          return;
        setProofs(items);
        setProofId((current) =>
          items.some((item) => item.id === current) ? current : "",
        );
      })
      .catch(() => {
        if (
          live &&
          useAppStore.getState().authEpoch === requestAuthEpoch &&
          useAppStore.getState().currentDealer?.id === dealerId
        )
          setProofs([]);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [
    dealerId,
    authEpoch,
    connection?.revision,
    connection?.configured,
    connection?.enabled,
    connection?.state,
  ]);

  const ready = destinations.find((destination) => destination.enabled);
  const hasWebsiteReceipt = Boolean(
    connection?.capabilities.some(
      (capability) => capability.id === "website" && capability.state === "verified",
    ),
  );
  const verified = Boolean(connection?.enabled && hasWebsiteReceipt);
  const runTest = async () => {
    if (!connection || !dealerId || !proofId) return;
    const requestAuthEpoch = authEpoch;
    const requestDealerId = dealerId;
    const runId = ++testRunId.current;
    const scope = `${dealerId}:${connection.revision}:${proofId}`;
    if (!testAttempt.current || testAttempt.current.scope !== scope)
      testAttempt.current = { scope, key: crypto.randomUUID() };
    const idempotencyKey = testAttempt.current.key;
    setTesting(true);
    setTestMessage(null);
    setTestError(null);
    try {
      const result = await testConnection("website", {
        dealerId,
        expectedRevision: connection.revision,
        idempotencyKey,
        proofId,
      });
      if (
        useAppStore.getState().authEpoch !== requestAuthEpoch ||
        useAppStore.getState().currentDealer?.id !== requestDealerId ||
        runId !== testRunId.current
      )
        return;
      setConnection((current) =>
        current
          ? {
              ...current,
              enabled: result.enabled,
              configured: result.configured,
              revision: result.revision,
              state: result.state,
              capabilities: result.capabilities,
            }
          : current,
      );
      if (result.state === "ready") setTestMessage("Connection verified.");
      else if (result.errorCode === "CONNECTION_DRAFT_PENDING")
        setTestMessage(
          "Draft delivery is still pending. Test this same saved draft again to confirm receipt.",
        );
      else
        setTestError(
          "The test did not verify the connection. Review the saved connection and try again.",
        );
      if (result.state !== "testing" && result.errorCode !== "CONNECTION_TEST_UNKNOWN")
        testAttempt.current = null;
    } catch (err) {
      if (
        useAppStore.getState().authEpoch === requestAuthEpoch &&
        useAppStore.getState().currentDealer?.id === requestDealerId &&
        runId === testRunId.current
      ) {
        if (typeof err === "object" && err !== null && "status" in err)
          testAttempt.current = null;
        setTestError(toUiMessage(err, "The connection test could not be completed."));
      }
    } finally {
      if (
        useAppStore.getState().authEpoch === requestAuthEpoch &&
        useAppStore.getState().currentDealer?.id === requestDealerId &&
        runId === testRunId.current
      )
        setTesting(false);
    }
  };
  return (
    <ServiceRow
      name="Dealership website"
      description="A post can send a private draft to your website. Your team reviews and publishes it in Customer Hub; nothing is public before that."
      aside={
        loading ? (
          <span className="text-sm text-ink-2">Checking…</span>
        ) : error ? null : verified && ready ? (
          <DoneMark>Connected and verified</DoneMark>
        ) : ready ? (
          <span className="text-sm text-ink-2">Connected · test required</span>
        ) : (
          <span className="text-sm text-ink-2">Not connected</span>
        )
      }
    >
      {loading ? null : error ? (
        <>
          <ErrorNote>{error}</ErrorNote>
          <div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={() => setRequestKey((key) => key + 1)}
            >
              Retry
            </Button>
          </div>
        </>
      ) : ready ? (
        <p className="flex flex-wrap items-center gap-x-3 text-sm text-ink-2">
          <span>
            {verified
              ? `Verified private draft connection to ${ready.label}.`
              : `Configured for ${ready.label}; run a test before relying on it.`}
          </span>
          {verified && ready.siteUrl ? (
            <a
              href={ready.siteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 text-brand-ink"
            >
              Open website <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : null}
        </p>
      ) : (
        <p className="text-sm text-ink-2">
          No private website draft destination is configured for this dealership.
          Contact your system administrator to connect one.
        </p>
      )}
      {!loading && !error && ready && !verified && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1 text-sm font-medium text-ink">
            Choose a test post
            <select
              className="mt-1 min-h-11 w-full rounded-sm border border-strong bg-panel px-3 text-sm text-ink"
              value={proofId}
              onChange={(event) => setProofId(event.target.value)}
              disabled={testing || proofs.length === 0}
            >
              <option value="">
                {proofs.length ? "Select a saved post" : "No eligible saved posts"}
              </option>
              {proofs.map((proof) => (
                <option key={proof.id} value={proof.id}>
                  {proof.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={!proofId || testing}
            onClick={() => void runTest()}
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {testMessage && (
            <p role="status" className="w-full text-sm text-ink-2">
              {testMessage}
            </p>
          )}
          {testError && <ErrorNote>{testError}</ErrorNote>}
        </div>
      )}
    </ServiceRow>
  );
};

/** "Connected services": the dealership website and the YouTube channel. */
export const ConnectedServices: React.FC = () => (
  <SettingsGroup title="Connected services">
    <div className="border-t border-hairline">
      <WebsiteConnectionRow />
      <YouTubeConnectionCard />
    </div>
  </SettingsGroup>
);
