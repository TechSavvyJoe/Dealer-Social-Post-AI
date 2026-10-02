import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  RefreshCw,
  Server,
  Workflow,
} from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { SystemHealthPanel } from "../SystemHealthPanel";

interface ConnectionState {
  configured: boolean;
  enabled: boolean;
  verification: "not_tested";
}
interface ConnectionsResponse {
  scope: "configuration_only";
  providers: Record<"gemini" | "anthropic" | "openai", ConnectionState>;
  automation: Record<"customer_hub" | "walkaround", ConnectionState>;
  apiContractVersion: string;
  modelPolicyVersion: string;
  capabilities: Record<string, boolean>;
}
const SERVICES = [
  {
    id: "gemini",
    group: "providers",
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
      "Connect the YouTube broker, then verify one complete test job before enabling the studio.",
    ],
  },
] as const;

/** Global infrastructure is deliberately absent from dealership-manager views. */
export const ConnectionsPanel: React.FC = () => {
  const role = useAppStore((s) => s.role);
  const authEpoch = useAppStore((s) => s.authEpoch);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const toast = useToast();
  const query = useQuery({
    queryKey: ["system-connections", authEpoch],
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
  const status = (service: (typeof SERVICES)[number]) =>
    service.group === "providers"
      ? data?.providers[service.id as keyof ConnectionsResponse["providers"]]
      : data?.automation[service.id as keyof ConnectionsResponse["automation"]];
  const count = SERVICES.filter(
    (service) => status(service)?.configured && status(service)?.enabled,
  ).length;
  return (
    <div className="space-y-7">
      <section
        className="relative isolate overflow-hidden rounded-xl border border-hairline bg-panel p-5 shadow-sm sm:p-7"
        aria-labelledby="connections-heading"
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-48 bg-gradient-to-b from-brand-tint to-transparent"
          aria-hidden="true"
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-brand-ink">
              <Server className="h-4 w-4" aria-hidden="true" />
              Platform control
            </p>
            <h2
              id="connections-heading"
              className="font-display text-3xl font-semibold text-ink sm:text-4xl"
            >
              AI providers & automation
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-2">
              Your platform connections. Dealerships manage their posting preferences
              separately.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => void query.refetch()}
            loading={query.isFetching}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            Refresh status
          </Button>
        </div>
        {query.error ? (
          <div
            role="alert"
            className="mt-5 rounded-md bg-error-fill p-4 text-sm text-error-ink"
          >
            {query.error.message}
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
          <p role="status" className="text-sm text-ink-2">
            {query.isPending
              ? "Checking configuration…"
              : data
                ? `${count} of ${SERVICES.length} services configured and enabled`
                : "Status unavailable"}
          </p>
          <div className="flex gap-2" role="group" aria-label="Connection filter">
            <Button
              variant={filter === "all" ? "primary" : "ghost"}
              size="sm"
              onClick={() => setFilter("all")}
            >
              All services
            </Button>
            <Button
              variant={filter === "attention" ? "primary" : "ghost"}
              size="sm"
              onClick={() => setFilter("attention")}
            >
              Needs setup
            </Button>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-2">
          Configuration checks do not verify provider access or complete a test
          transaction.
        </p>
      </section>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {SERVICES.filter(
          (service) =>
            filter === "all" ||
            !status(service)?.configured ||
            !status(service)?.enabled,
        ).map((service) => {
          const state = status(service);
          const open = expanded === service.id;
          const label = !state
            ? "Not checked"
            : !state.configured
              ? "Needs setup"
              : !state.enabled
                ? "Configured · disabled"
                : "Configured";
          return (
            <section
              key={service.id}
              className="rounded-xl border border-hairline bg-panel p-5 shadow-sm transition-colors hover:border-strong sm:p-6"
            >
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
                {service.group === "providers" ? "AI provider" : "Dealer service"}
              </p>
              <div className="flex flex-wrap items-start gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-brand-ink/20 bg-brand-tint text-brand-ink">
                  {service.group === "providers" ? (
                    <KeyRound className="h-5 w-5" />
                  ) : (
                    <Workflow className="h-5 w-5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold text-ink">{service.title}</h3>
                  <p className="mt-1 text-sm text-ink-2">{service.description}</p>
                </div>
                <span
                  className={`rounded-sm px-2.5 py-1 text-xs font-medium ${state?.configured && state.enabled ? "bg-success-fill text-success-ink" : "bg-warning-fill text-warning-ink"}`}
                >
                  {label}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-3"
                aria-expanded={open}
                aria-controls={`connection-setup-${service.id}`}
                onClick={() => setExpanded(open ? null : service.id)}
                rightIcon={
                  <ChevronDown className={`h-4 w-4 ${open ? "rotate-180" : ""}`} />
                }
              >
                Setup instructions
              </Button>
              {open && (
                <div
                  id={`connection-setup-${service.id}`}
                  className="mt-3 rounded-md border border-hairline bg-panel-raised p-4"
                >
                  <ol className="ml-4 list-decimal space-y-2 text-sm leading-relaxed text-ink-2">
                    {service.steps.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ol>
                  <details className="mt-4 border-t border-hairline pt-3">
                    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink">
                      Advanced configuration
                    </summary>
                    <p className="mb-3 text-sm text-ink-2">
                      Set these variables in the backend’s secret settings. Credentials
                      stay on the server.
                    </p>
                    <div className="space-y-1 break-all font-mono text-xs text-ink-2">
                      {service.variables.map((name) => (
                        <p key={name}>{name}</p>
                      ))}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-4"
                      leftIcon={<Copy className="h-4 w-4" />}
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
              )}
            </section>
          );
        })}
        {filter === "attention" && data && count === SERVICES.length && (
          <p className="p-6 text-sm text-ink-2">
            <Check className="mr-2 inline h-4 w-4" />
            Every service has its configuration in place.
          </p>
        )}
      </div>
      <section aria-labelledby="runtime-heading">
        <div className="mb-3 flex items-center gap-2">
          <Server className="h-5 w-5 text-ink-2" />
          <h2
            id="runtime-heading"
            className="font-display text-xl font-semibold text-ink"
          >
            Runtime & recovery
          </h2>
        </div>
        <p className="mb-4 text-sm text-ink-2">
          Service health, recent generation results and verified backup evidence.
        </p>
        <SystemHealthPanel />
      </section>
      {data && (
        <details className="rounded-md border border-hairline bg-panel px-5">
          <summary className="min-h-11 cursor-pointer py-4 text-sm font-medium text-ink">
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
      )}
    </div>
  );
};
