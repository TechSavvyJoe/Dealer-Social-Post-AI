import React, { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "../ui/Button";
import { YouTubeConnectionCard } from "../YouTubeConnectionCard";
import { toUiMessage } from "../../utils/errorMessages";
import {
  listWebsiteDestinations,
  type WebsiteDestination,
} from "../../services/websitePublishing";
import { DoneMark, ErrorNote, ServiceRow, SettingsGroup } from "./SettingsRows";

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

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void listWebsiteDestinations(controller.signal)
      .then(setDestinations)
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(toUiMessage(err, "Could not check the private website connection."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestKey]);

  const ready = destinations.find((destination) => destination.enabled);
  return (
    <ServiceRow
      name="Dealership website"
      description="A post can send a private draft to your website. Your team reviews and publishes it in Customer Hub; nothing is public before that."
      aside={
        loading ? (
          <span className="text-sm text-ink-2">Checking…</span>
        ) : error ? null : ready ? (
          <DoneMark>Connected</DoneMark>
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
          <span>Connected to {ready.label}.</span>
          {ready.siteUrl ? (
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
