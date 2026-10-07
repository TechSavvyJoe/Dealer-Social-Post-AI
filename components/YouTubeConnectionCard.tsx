import React from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import {
  completeYouTubeConnection,
  disconnectYouTubeConnection,
  getYouTubeConnection,
  startYouTubeConnection,
} from "../services/walkarounds";
import { Modal } from "./ui/Modal";
import { toUiMessage } from "../utils/errorMessages";
import { DoneMark, ErrorNote, ServiceRow } from "./dealer-settings/SettingsRows";

/**
 * The store's YouTube channel, as one row under "Connected services". Every
 * state and action is the one it always had (connected with Disconnect, the
 * two-step Google authorization, errors); only the chrome changed.
 */
export const YouTubeConnectionCard: React.FC = () => {
  const [status, setStatus] = React.useState<{
    connected: boolean;
    channelTitle?: string;
  } | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = React.useState("");
  const [stateReference, setStateReference] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void getYouTubeConnection()
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch((cause) => {
        if (active) setError(toUiMessage(cause, "YouTube status is unavailable."));
      });
    return () => {
      active = false;
    };
  }, []);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError(toUiMessage(cause, "YouTube connection failed safely."));
    } finally {
      setBusy(false);
    }
  };

  const connected = Boolean(status?.connected);

  return (
    <>
      <ServiceRow
        name="YouTube channel"
        description="For reviewed walkaround videos. You sign in on Google, so this app never sees the password."
        aside={
          connected ? (
            <>
              <DoneMark>Connected</DoneMark>
              <Button
                variant="secondary"
                size="md"
                className="px-3.5 text-sm"
                onClick={() => setDisconnectOpen(true)}
              >
                Disconnect YouTube
              </Button>
            </>
          ) : !authorizationUrl ? (
            <Button
              variant="secondary"
              size="md"
              className="px-3.5 text-sm"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const result = await startYouTubeConnection();
                  setAuthorizationUrl(result.authorizationUrl);
                })
              }
            >
              Connect
            </Button>
          ) : null
        }
      >
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {connected ? (
          <p className="text-sm text-ink-2">
            Connected to {status?.channelTitle || "verified dealership channel"}.
          </p>
        ) : authorizationUrl ? (
          <div className="flex flex-col items-start gap-3">
            <a
              href={authorizationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-strong bg-panel-raised px-4 text-sm font-semibold text-ink hover:no-underline"
            >
              Authorize with Google
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
            <Input
              label="One-time authorization return code"
              autoComplete="off"
              value={stateReference}
              onChange={(event) => setStateReference(event.target.value)}
              fullWidth
            />
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              disabled={!stateReference.trim()}
              onClick={() =>
                void run(async () => {
                  const result = await completeYouTubeConnection(stateReference.trim());
                  setStatus(result);
                  setAuthorizationUrl("");
                  setStateReference("");
                })
              }
            >
              Complete connection
            </Button>
            <p className="text-caption text-ink-2">
              OAuth tokens never enter the browser or PocketBase records; only the
              trusted broker keeps the credential reference.
            </p>
          </div>
        ) : null}
      </ServiceRow>
      <Modal
        isOpen={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title="Disconnect dealership YouTube?"
        description="New walkaround publications will be blocked until a manager reconnects."
        disableClose={busy}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setDisconnectOpen(false)}
            >
              Keep connected
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await disconnectYouTubeConnection();
                  setStatus({ connected: false });
                  setDisconnectOpen(false);
                })
              }
            >
              Disconnect
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          Published YouTube videos are retained. This only revokes the dealership
          connection used for future uploads.
        </p>
      </Modal>
    </>
  );
};
