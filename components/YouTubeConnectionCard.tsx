import React from "react";
import { CheckCircle2, ExternalLink, Video } from "lucide-react";
import { Button } from "./ui/Button";
import {
  completeYouTubeConnection,
  disconnectYouTubeConnection,
  getYouTubeConnection,
  startYouTubeConnection,
} from "../services/walkarounds";
import { Modal } from "./ui/Modal";

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
        if (active)
          setError(
            cause instanceof Error ? cause.message : "YouTube status is unavailable.",
          );
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
      setError(
        cause instanceof Error ? cause.message : "YouTube connection failed safely.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-hairline bg-surface-900/65 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-error-500/15">
          <Video className="h-5 w-5 text-error-300" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-surface-50">YouTube channel</h2>
          <p className="mt-1 text-sm text-surface-400">
            Connect the dealership-owned channel used for reviewed walkaround videos.
          </p>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-error-400/30 bg-error-500/10 p-3 text-sm text-error-100 [.theme-light_&]:text-error-800"
        >
          {error}
        </p>
      )}
      {status?.connected ? (
        <div className="mt-4 space-y-3">
          <p className="flex items-center gap-2 rounded-xl border border-success-400/30 bg-success-500/10 p-3 text-sm font-semibold text-success-200">
            <CheckCircle2 className="h-5 w-5" />
            Connected to {status.channelTitle || "verified dealership channel"}
          </p>
          <Button variant="danger" size="sm" onClick={() => setDisconnectOpen(true)}>
            Disconnect YouTube
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {!authorizationUrl ? (
            <Button
              variant="outline"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const result = await startYouTubeConnection();
                  setAuthorizationUrl(result.authorizationUrl);
                })
              }
            >
              Start secure connection
            </Button>
          ) : (
            <>
              <a
                href={authorizationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-500 px-4 py-2 font-semibold text-white"
              >
                Authorize with Google
                <ExternalLink className="h-4 w-4" />
              </a>
              <label className="block text-sm font-medium text-surface-200">
                One-time authorization return code
                <input
                  className="mt-2 min-h-11 w-full rounded-xl border border-hairline bg-surface-950/45 px-3 py-2 text-surface-50 outline-none focus:border-primary-400"
                  autoComplete="off"
                  value={stateReference}
                  onChange={(event) => setStateReference(event.target.value)}
                />
              </label>
              <Button
                loading={busy}
                disabled={!stateReference.trim()}
                onClick={() =>
                  void run(async () => {
                    const result = await completeYouTubeConnection(
                      stateReference.trim(),
                    );
                    setStatus(result);
                    setAuthorizationUrl("");
                    setStateReference("");
                  })
                }
              >
                Complete connection
              </Button>
            </>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-surface-400">
        OAuth tokens never enter the browser or PocketBase records; only the trusted
        broker keeps the credential reference.
      </p>
      <Modal
        isOpen={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title="Disconnect dealership YouTube?"
        description="New walkaround publications will be blocked until a manager reconnects."
        disableClose={busy}
        footer={
          <>
            <Button
              variant="outline"
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
        <p className="text-sm text-surface-300">
          Published YouTube videos are retained. This only revokes the dealership
          connection used for future uploads.
        </p>
      </Modal>
    </section>
  );
};
