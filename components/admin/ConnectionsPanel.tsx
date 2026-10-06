import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, RefreshCw } from "lucide-react";
import type { Dealer } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { cn } from "../../utils/classNames";
import { joinWords } from "../../utils/dealerSetupStatus";
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
    description: "Writes captions and makes the images and videos.",
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

/** The status in words at the right of a service row. */
const StatusWords: React.FC<{
  badge: ReturnType<typeof statusBadge>;
}> = ({ badge }) => (
  <span
    className={cn(
      "flex shrink-0 items-center gap-1.5 text-sm font-medium sm:w-44",
      badge.variant === "success"
        ? "text-ink"
        : badge.variant === "warning"
          ? "text-warning-ink"
          : "text-ink-2",
    )}
  >
    {badge.variant === "success" ? (
      <Check className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
    ) : badge.variant === "warning" ? (
      <span
        aria-hidden="true"
        className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-warning-ink bg-warning-fill"
      />
    ) : null}
    {badge.label}
  </span>
);

/**
 * Global infrastructure is deliberately absent from dealership-manager views.
 * `dealers` is the loaded store list; leave it undefined while the list is
 * still loading (or failed) so a mapped store is never called missing.
 * `onCheckAgain` is the hub's refresh; without it, "Check again" refetches
 * this page's status alone.
 */
export const ConnectionsPanel: React.FC<{
  dealers?: readonly Dealer[];
  onCheckAgain?: () => void;
}> = ({ dealers, onCheckAgain }) => {
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
  const shown = (service: Service) => filter === "all" || needsSetup(service);
  const visibleRequired = required.filter(shown);
  const visibleOptional = optional.filter(shown);
  const missingRequired = required.filter(needsSetup);

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

  const checkAgain = onCheckAgain ?? (() => void query.refetch());

  const serviceRow = (service: Service) => {
    const badge = statusBadge(service, status(service));
    const open = expanded === service.id;
    const titleId = `connection-title-${service.id}`;
    const setupId = `connection-setup-${service.id}`;
    return (
      <section
        key={service.id}
        aria-labelledby={titleId}
        className="border-t border-hairline"
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-4">
          <div className="min-w-0 flex-[1_1_17.5rem] space-y-0.5">
            <h4
              id={titleId}
              className="text-[17px] font-semibold leading-[22px] text-ink"
            >
              {service.title}
            </h4>
            <p className="text-sm text-ink-2">{service.description}</p>
            {service.id === "customer_hub" && websiteMapping ? (
              <p className="text-sm text-ink">{websiteMapping}</p>
            ) : null}
          </div>
          <StatusWords badge={badge} />
          <Button
            variant="ghost"
            className="-mr-1 px-3 text-sm text-ink"
            aria-expanded={open}
            aria-controls={setupId}
            onClick={() => setExpanded(open ? null : service.id)}
            rightIcon={
              <ChevronDown
                className={cn(
                  "text-ink-2 transition-transform duration-180 ease-out motion-reduce:transition-none",
                  open && "rotate-180",
                )}
              />
            }
          >
            Setup instructions
          </Button>
        </div>
        {open ? (
          <div id={setupId} className="flex flex-col gap-4 pb-5">
            <ol className="max-w-[62ch] list-decimal space-y-1.5 pl-5 text-[15px] leading-[22px] text-ink">
              {service.steps.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ol>
            <div className="flex flex-col gap-3 rounded-sm bg-panel px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm text-ink-2">
                  {service.variables.length === 1 ? "Setting name" : "Setting names"}
                </span>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 break-all font-mono text-sm text-ink">
                  {service.variables.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
              {service.id === "gemini" && data ? (
                <p className="flex items-baseline gap-3 text-sm">
                  <span className="text-ink-2">Model policy</span>
                  <span className="text-ink">Version {data.modelPolicyVersion}</span>
                </p>
              ) : null}
              <p className="text-sm text-ink-2">
                Set these in the backend’s secret settings. Credentials stay on the
                server.
              </p>
              <Button
                variant="secondary"
                className="self-start px-3.5 text-sm"
                leftIcon={<Copy />}
                onClick={async () => {
                  try {
                    if (!navigator.clipboard?.writeText)
                      throw new Error("Clipboard unavailable");
                    await navigator.clipboard.writeText(service.variables.join("\n"));
                    toast.success("Variable names copied.");
                  } catch {
                    toast.error("Could not copy. Select the names above instead.");
                  }
                }}
              >
                Copy variable names
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    );
  };

  const overall = query.isPending
    ? null
    : data
      ? missingRequired.length === 0
        ? { done: true, text: "Everything the app needs is set up" }
        : {
            done: false,
            text: `${joinWords(missingRequired.map((service) => service.title))} ${
              missingRequired.length === 1 ? "needs" : "need"
            } setup`,
          }
      : null;

  return (
    <div className="flex flex-wrap items-start gap-x-16 gap-y-10">
      <div className="flex min-w-0 flex-[999_1_32.5rem] flex-col gap-9">
        <section aria-labelledby="connections-heading" className="flex flex-col gap-4">
          <div className="space-y-1">
            <h2
              id="connections-heading"
              className="font-display text-[1.625rem] font-semibold leading-[1.875rem] tracking-[-0.01em] text-ink md:text-3xl"
            >
              Providers and automation
            </h2>
            <p className="text-sm text-ink-2 md:text-base">
              Only system admins see this page. Stores never see provider settings.
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
          <div className="flex gap-1" role="group" aria-label="Connection filter">
            <Button
              variant={filter === "all" ? "secondary" : "ghost"}
              className="px-3.5 text-sm"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All services
            </Button>
            <Button
              variant={filter === "attention" ? "secondary" : "ghost"}
              className="px-3.5 text-sm"
              aria-pressed={filter === "attention"}
              onClick={() => setFilter("attention")}
            >
              Needs setup
            </Button>
          </div>
        </section>

        {visibleRequired.length > 0 ? (
          <section aria-labelledby="connections-required" className="flex flex-col">
            <h3
              id="connections-required"
              className="mb-2.5 font-display text-[1.375rem] font-semibold leading-7 text-ink"
            >
              Required
            </h3>
            <div className="border-b border-hairline">
              {visibleRequired.map(serviceRow)}
            </div>
          </section>
        ) : filter === "attention" && data ? (
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <Check
              className="h-4 w-4 text-ink-2"
              strokeWidth={2.25}
              aria-hidden="true"
            />
            Every required service has its configuration in place.
          </p>
        ) : null}

        {visibleOptional.length > 0 ? (
          <section aria-labelledby="connections-optional" className="flex flex-col">
            <h3
              id="connections-optional"
              className="font-display text-[1.375rem] font-semibold leading-7 text-ink"
            >
              Optional
            </h3>
            <p className="mb-2.5 mt-0.5 text-sm text-ink-2">
              The app works without these. Turn one on only when you want it.
            </p>
            <div className="border-b border-hairline">
              {visibleOptional.map(serviceRow)}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="runtime-heading" className="flex flex-col gap-3">
          <div className="space-y-0.5">
            <h3
              id="runtime-heading"
              className="font-display text-[1.375rem] font-semibold leading-7 text-ink"
            >
              Runtime & recovery
            </h3>
            <p className="text-sm text-ink-2">
              Service health, recent generation results and verified backup evidence.
            </p>
          </div>
          <SystemHealthPanel />
        </section>

        {data ? (
          <details className="border-y border-hairline">
            <summary className="min-h-11 cursor-pointer py-3 text-[15px] font-semibold text-ink">
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

      <aside
        aria-label="Configuration status"
        className="flex w-full flex-col gap-5 md:max-w-[21.25rem] md:flex-[1_1_17.5rem] md:pt-1"
      >
        <div className="flex flex-col gap-1.5">
          {overall ? (
            <p className="flex items-start gap-2 text-lg font-semibold text-ink">
              {overall.done ? (
                <Check
                  className="mt-1 h-4 w-4 shrink-0"
                  strokeWidth={2.25}
                  aria-hidden="true"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="mt-[5px] inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-warning-ink bg-warning-fill"
                />
              )}
              {overall.text}
            </p>
          ) : null}
          <p role="status" className="text-sm text-ink-2">
            {query.isPending
              ? "Checking configuration…"
              : data
                ? `${requiredOn} of ${plural(required.length, "required service", "required services")} configured and enabled. ${optionalOn} of ${plural(optional.length, "optional fallback", "optional fallbacks")} on.`
                : "Status unavailable"}
          </p>
        </div>
        <div className="flex flex-col gap-3 border-t border-hairline pt-5">
          <h3 className="text-base font-semibold text-ink">What this page checks</h3>
          <p className="text-sm text-ink-2">
            It reads your configuration only. It does not call a provider or run a test.
          </p>
          <p className="text-sm text-ink-2">
            Keys and passwords are never shown here, only the names of the settings.
          </p>
          <Button
            variant="secondary"
            className="self-start px-3.5 text-sm"
            loading={query.isFetching}
            leftIcon={<RefreshCw />}
            onClick={checkAgain}
          >
            Check again
          </Button>
        </div>
      </aside>
    </div>
  );
};
