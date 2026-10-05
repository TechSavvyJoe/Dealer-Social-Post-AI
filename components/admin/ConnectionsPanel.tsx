import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Copy } from "lucide-react";
import type { Dealer } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { cn } from "../../utils/classNames";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { SystemHealthPanel } from "../SystemHealthPanel";

interface ConnectionState {
  configured: boolean;
  enabled: boolean;
  verification: "not_tested";
  /** Customer website only: the dealership the destination is mapped to. */
  dealerId?: string;
}
interface ConnectionsResponse {
  scope: "configuration_only";
  providers: Record<"gemini" | "anthropic" | "openai", ConnectionState>;
  automation: Record<"customer_hub" | "walkaround", ConnectionState>;
  apiContractVersion: string;
  modelPolicyVersion: string;
  capabilities: Record<string, boolean>;
}

/** Query key prefix; the hub's Refresh invalidates it on this tab. */
export const SYSTEM_CONNECTIONS_QUERY_KEY = "system-connections";

const SERVICES = [
  {
    id: "gemini",
    group: "providers",
    optional: false,
    title: "Google Gemini",
    description: "Primary caption, image and video generation.",
    variables: ["GEMINI_API_KEY"],
    steps: [
      "Set the Gemini key on the backend host.",
      "Confirm that the project has access to the configured image and video models.",
      "Run a generation check before making the service available to stores.",
    ],
  },
  {
    id: "anthropic",
    group: "providers",
    optional: true,
    title: "Anthropic fallback",
    description: "Optional fallback for supported text tasks.",
    variables: ["ANTHROPIC_API_KEY", "ENABLE_CLAUDE_FALLBACK"],
    steps: [
      "Set the Anthropic key on the backend host.",
      "Enable the fallback only after the account and model access are verified.",
      "The existing model policy determines which tasks may use it.",
    ],
  },
  {
    id: "openai",
    group: "providers",
    optional: true,
    title: "OpenAI fallback",
    description: "Optional fallback for supported text tasks.",
    variables: ["OPENAI_API_KEY", "ENABLE_OPENAI_FALLBACK"],
    steps: [
      "Set the OpenAI key on the backend host.",
      "Enable the fallback after verifying project access and spending limits.",
      "Run a supported task to verify actual provider access.",
    ],
  },
  {
    id: "customer_hub",
    group: "automation",
    optional: false,
    title: "Customer website",
    description:
      "Private post drafts sent to the connected customer website for review.",
    variables: [
      "CUSTOMER_HUB_URL",
      "CUSTOMER_HUB_SECRET",
      "CUSTOMER_HUB_DESTINATION_ID",
      "CUSTOMER_HUB_DEALER_ID",
    ],
    steps: [
      "Configure the destination and shared credential on the backend.",
      "Keep the destination mapped to the intended dealership.",
      "Send a test draft and verify receipt in the private website workspace before publishing.",
    ],
  },
  {
    id: "walkaround",
    group: "automation",
    optional: false,
    title: "Walkaround video pipeline",
    description:
      "Upload storage, processing workers and YouTube delivery for enabled stores.",
    variables: [
      "WALKAROUND_STUDIO_ENABLED",
      "WALKAROUND_GCS_BUCKET",
      "WALKAROUND_UPLOAD_BROKER_URL",
      "WALKAROUND_UPLOAD_BROKER_TOKEN",
      "WALKAROUND_YOUTUBE_BROKER_URL",
      "WALKAROUND_YOUTUBE_BROKER_TOKEN",
      "WALKAROUND_WORKER_TOKEN",
      "WALKAROUND_WORKER_SIGNING_SECRET",
    ],
    steps: [
      "Configure private upload storage and the upload broker.",
      "Configure the processing worker and signing credentials.",
      "Connect the YouTube broker, then verify one complete test job before turning on walkaround videos.",
    ],
  },
] as const;

type Service = (typeof SERVICES)[number];

const isOn = (state: ConnectionState | undefined) =>
  Boolean(state?.configured && state.enabled);

/**
 * Status in plain words. Optional fallbacks that are off are a choice, not a
 * problem, so they never take the warning treatment.
 */
const statusBadge = (
  service: Service,
  state: ConnectionState | undefined,
): { label: string; variant: "success" | "warning" | "neutral" } => {
  if (!state) return { label: "Not checked", variant: "neutral" };
  if (isOn(state)) return { label: "Configured", variant: "success" };
  if (service.optional) {
    return {
      label: state.configured ? "Optional, turned off" : "Optional, not set up",
      variant: "neutral",
    };
  }
  return {
    label: state.configured ? "Configured, turned off" : "Needs setup",
    variant: "warning",
  };
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Global infrastructure is deliberately absent from dealership-manager views.
 * `dealers` is the loaded store list; leave it undefined while the list is
 * still loading (or failed) so a mapped store is never called missing.
 */
export const ConnectionsPanel: React.FC<{ dealers?: readonly Dealer[] }> = ({
  dealers,
}) => {
  const role = useAppStore((s) => s.role);
  const authEpoch = useAppStore((s) => s.authEpoch);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const toast = useToast();
  const query = useQuery({
    queryKey: [SYSTEM_CONNECTIONS_QUERY_KEY, authEpoch],
    enabled: role === "super_admin",
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<ConnectionsResponse> => {
      const response = await fetch("/api/app/connections", {
        credentials: "include",
        cache: "no-store",
        signal,
      });
      if (!response.ok)
        throw new Error(
          response.status === 404
            ? "Connection diagnostics need the updated backend. Deploy the backend first, then refresh."
            : response.status === 403
              ? "Only the system administrator can view these connections."
              : "Connection status could not be loaded. Try again.",
        );
      return response.json();
    },
  });
  if (role !== "super_admin") return null;
  const data = query.data;
  const status = (service: Service): ConnectionState | undefined =>
    service.group === "providers"
      ? data?.providers[service.id as keyof ConnectionsResponse["providers"]]
      : data?.automation[service.id as keyof ConnectionsResponse["automation"]];

  const required = SERVICES.filter((service) => !service.optional);
  const optional = SERVICES.filter((service) => service.optional);
  const requiredOn = required.filter((service) => isOn(status(service))).length;
  const optionalOn = optional.filter((service) => isOn(status(service))).length;
  const needsSetup = (service: Service) => !service.optional && !isOn(status(service));
  const visible = SERVICES.filter((service) => filter === "all" || needsSetup(service));

  const websiteState = data?.automation.customer_hub;
  const websiteDealerId = websiteState?.dealerId?.trim() || "";
  const websiteDealer = websiteDealerId
    ? dealers?.find((dealer) => dealer.id === websiteDealerId)
    : undefined;
  // Which store the customer website belongs to. Only a working destination
  // "sends"; before that it is just mapped. A store missing from the list is
  // reported only once the list has loaded.
  const websiteMapping = !websiteDealerId
    ? null
    : websiteDealer
      ? isOn(websiteState)
        ? `Sends drafts for ${websiteDealer.name}.`
        : `Mapped to ${websiteDealer.name}.`
      : dealers
        ? `Mapped to dealership ${websiteDealerId}, which is not in the dealer list.`
        : null;

  return (
    <div className="space-y-8">
      <section className="space-y-4" aria-labelledby="connections-heading">
        <div>
          <h3
            id="connections-heading"
            className="font-display text-2xl font-semibold text-ink"
          >
            AI providers & automation
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">
            Your platform connections. Dealerships manage their posting preferences
            separately.
          </p>
        </div>
        {query.error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-error-fill p-4 text-sm text-error-ink"
          >
            <span className="min-w-0 flex-1">{query.error.message}</span>
            <Button
              variant="secondary"
              size="md"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
          <p role="status" className="text-sm text-ink-2">
            {query.isPending
              ? "Checking configuration…"
              : data
                ? `${requiredOn} of ${plural(required.length, "required service", "required services")} configured and enabled. ${optionalOn} of ${plural(optional.length, "optional fallback", "optional fallbacks")} on.`
                : "Status unavailable"}
          </p>
          <div className="flex gap-1" role="group" aria-label="Connection filter">
            <Button
              variant={filter === "all" ? "secondary" : "ghost"}
              size="md"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All services
            </Button>
            <Button
              variant={filter === "attention" ? "secondary" : "ghost"}
              size="md"
              aria-pressed={filter === "attention"}
              onClick={() => setFilter("attention")}
            >
              Needs setup
            </Button>
          </div>
        </div>
        <p className="text-caption text-ink-2">
          Configuration checks do not verify provider access or complete a test
          transaction.
        </p>
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {visible.map((service) => {
            const state = status(service);
            const badge = statusBadge(service, state);
            const open = expanded === service.id;
            const titleId = `connection-title-${service.id}`;
            return (
              <section
                key={service.id}
                aria-labelledby={titleId}
                className="rounded-md border border-hairline bg-panel p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h4
                      id={titleId}
                      className="font-display text-lg font-semibold text-ink"
                    >
                      {service.title}
                    </h4>
                    <p className="mt-1 text-sm text-ink-2">{service.description}</p>
                    {service.id === "customer_hub" && websiteMapping ? (
                      <p className="mt-1 text-sm text-ink">{websiteMapping}</p>
                    ) : null}
                  </div>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="md"
                  className="-ml-3 mt-2"
                  aria-expanded={open}
                  aria-controls={`connection-setup-${service.id}`}
                  onClick={() => setExpanded(open ? null : service.id)}
                  rightIcon={
                    <ChevronDown
                      className={cn(
                        "transition-transform duration-180 ease-out motion-reduce:transition-none",
                        open && "rotate-180",
                      )}
                    />
                  }
                >
                  Setup instructions
                </Button>
                {open ? (
                  <div
                    id={`connection-setup-${service.id}`}
                    className="mt-2 space-y-3 border-t border-hairline pt-4"
                  >
                    <h5 className="font-display text-lg font-semibold text-ink">
                      Setup
                    </h5>
                    <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
                      {service.steps.map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ol>
                    <details className="border-t border-hairline">
                      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink">
                        Advanced configuration
                      </summary>
                      <p className="mb-3 text-sm text-ink-2">
                        Set these variables in the backend’s secret settings.
                        Credentials stay on the server.
                      </p>
                      <ul className="space-y-1 break-all font-mono text-xs text-ink-2">
                        {service.variables.map((name) => (
                          <li key={name}>{name}</li>
                        ))}
                      </ul>
                      <Button
                        variant="secondary"
                        size="md"
                        className="mb-1 mt-4"
                        leftIcon={<Copy />}
                        onClick={async () => {
                          try {
                            if (!navigator.clipboard?.writeText)
                              throw new Error("Clipboard unavailable");
                            await navigator.clipboard.writeText(
                              service.variables.join("\n"),
                            );
                            toast.success("Variable names copied.");
                          } catch {
                            toast.error(
                              "Could not copy. Select the names above instead.",
                            );
                          }
                        }}
                      >
                        Copy variable names
                      </Button>
                    </details>
                  </div>
                ) : null}
              </section>
            );
          })}
          {filter === "attention" && data && visible.length === 0 ? (
            <p className="flex items-center gap-2 py-2 text-sm text-ink-2">
              <Check className="h-4 w-4 text-success-ink" aria-hidden="true" />
              Every required service has its configuration in place.
            </p>
          ) : null}
        </div>
      </section>
      <section className="space-y-3" aria-labelledby="runtime-heading">
        <div>
          <h3
            id="runtime-heading"
            className="font-display text-2xl font-semibold text-ink"
          >
            Runtime & recovery
          </h3>
          <p className="mt-1 text-sm text-ink-2">
            Service health, recent generation results and verified backup evidence.
          </p>
        </div>
        <SystemHealthPanel />
      </section>
      {data ? (
        <details className="rounded-md border border-hairline bg-panel px-4 sm:px-5">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink">
            Runtime versions & capabilities
          </summary>
          <dl className="grid gap-3 border-t border-hairline py-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-2">API contract</dt>
              <dd className="mt-1 font-mono text-ink">{data.apiContractVersion}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Model policy</dt>
              <dd className="mt-1 text-ink">{data.modelPolicyVersion}</dd>
            </div>
            {Object.entries(data.capabilities).map(([name, enabled]) => (
              <div key={name}>
                <dt className="text-ink-2">
                  {name === "veoNegativePrompt" ? "Video negative prompts" : name}
                </dt>
                <dd className="mt-1 text-ink">
                  {enabled ? "Available" : "Unavailable"}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
};
