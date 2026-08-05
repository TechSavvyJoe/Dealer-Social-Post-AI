import { credentials } from "@outputai/credentials";
import { FatalError, z } from "@outputai/core";
import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/client";

import { backend } from "./shared/clients/backend.js";
import { mediaWorker } from "./shared/clients/media_worker.js";

const TaskInputSchema = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  expectedRevision: z.number().int().nonnegative(),
});

const DispatcherTaskSchema = z.object({
  taskId: z.string(),
  leaseToken: z.string(),
  kind: z.enum(["produce", "validate_review", "publish_youtube", "delete_objects"]),
  idempotencyKey: z.string(),
  input: TaskInputSchema,
  review: z
    .object({
      masterStorageKey: z.string(),
      masterSha256: z.string(),
      metadata: z.record(z.string(), z.unknown()),
      vehicleSnapshot: z.record(z.string(), z.unknown()),
      bannedPhrases: z.array(z.string()),
      captionsText: z.string().max(30000).optional(),
    })
    .optional(),
  deletion: z
    .object({
      scope: z.enum(["project", "asset"]),
      objects: z.array(
        z.object({
          storageKey: z.string(),
          storageGeneration: z.string().optional(),
        }),
      ),
    })
    .optional(),
});

const ClaimResponseSchema = z.object({ task: DispatcherTaskSchema.nullable() });
type DispatcherTask = z.infer<typeof DispatcherTaskSchema>;

export type DispatcherDependencies = {
  claim: () => Promise<DispatcherTask | null>;
  start: (task: DispatcherTask) => Promise<{ runId: string }>;
  executeReviewValidation: (task: DispatcherTask) => Promise<unknown>;
  executeDeletion: (task: DispatcherTask) => Promise<unknown>;
  renew: (task: DispatcherTask) => Promise<void>;
  ack: (task: DispatcherTask, result: unknown) => Promise<void>;
  nack: (task: DispatcherTask, errorCode: string) => Promise<void>;
};

export async function dispatchOnce(
  dependencies: DispatcherDependencies,
): Promise<boolean> {
  const task = await dependencies.claim();
  if (!task) return false;
  try {
    if (task.kind === "delete_objects") {
      const result = await withLeaseRenewal(task, dependencies, () =>
        dependencies.executeDeletion(task),
      );
      await dependencies.ack(task, result);
      return true;
    }
    if (task.kind === "validate_review") {
      const result = await withLeaseRenewal(task, dependencies, () =>
        dependencies.executeReviewValidation(task),
      );
      await dependencies.ack(task, result);
      return true;
    }
    const started = await dependencies.start(task);
    await dependencies.ack(task, { temporalRunId: started.runId });
    return true;
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      await dependencies.ack(task, { temporalRunId: "already-started" });
      return true;
    }
    await dependencies.nack(task, "TASK_EXECUTION_FAILED");
    throw error;
  }
}

async function withLeaseRenewal<T>(
  task: DispatcherTask,
  dependencies: DispatcherDependencies,
  operation: () => Promise<T>,
): Promise<T> {
  const renewalErrors: unknown[] = [];
  const timer = setInterval(() => {
    dependencies.renew(task).catch((error) => renewalErrors.push(error));
  }, 20_000);
  try {
    const result = await operation();
    if (renewalErrors.length > 0) throw renewalErrors[0];
    return result;
  } finally {
    clearInterval(timer);
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new FatalError(`${name} is required for the walkaround dispatcher`);
  return value;
}

async function main(): Promise<void> {
  const dispatcherId = requiredEnvironment("OUTPUT_CATALOG_ID");
  const address = process.env.TEMPORAL_ADDRESS || "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE || "default";
  const apiKeyValue = credentials.get("walkaround.temporal_api_key");
  const apiKey =
    typeof apiKeyValue === "string" && apiKeyValue ? apiKeyValue : undefined;
  const connection = await Connection.connect({
    address,
    ...(apiKey ? { apiKey, tls: true } : {}),
  });
  const temporal = new Client({ connection, namespace });
  const dependencies: DispatcherDependencies = {
    claim: async () => {
      const claimKey = `${dispatcherId}:claim:${Date.now()}`;
      const response = ClaimResponseSchema.parse(
        await backend.claimTask(
          {
            dispatcherId,
            leaseSeconds: 60,
          },
          claimKey,
        ),
      );
      return response.task;
    },
    start: async (task) => {
      const workflowName =
        task.kind === "produce"
          ? "vehicle_walkaround_producer"
          : "youtube_walkaround_publisher";
      const handle = await temporal.workflow.start(workflowName, {
        taskQueue: dispatcherId,
        workflowId: task.input.workflowId,
        args: [task.input],
        workflowExecutionTimeout: "24h",
      });
      return { runId: handle.firstExecutionRunId };
    },
    executeReviewValidation: async (task) => {
      if (!task.review)
        throw new FatalError(
          "Review validation task is missing server-derived context",
        );
      return mediaWorker.qualityCheck(
        {
          projectId: task.input.projectId,
          expectedRevision: task.input.expectedRevision,
          ...task.review,
        },
        task.idempotencyKey,
      );
    },
    executeDeletion: async (task) => {
      if (
        !task.deletion ||
        (task.deletion.scope === "asset" && task.deletion.objects.length !== 1)
      ) {
        throw new FatalError(
          "Deletion task is missing an exact server-derived object set",
        );
      }
      return mediaWorker.deleteObjects(
        {
          projectId: task.input.projectId,
          scope: task.deletion.scope,
          objects: task.deletion.objects,
        },
        task.idempotencyKey,
      );
    },
    renew: async (task) => {
      await backend.renewTask(
        task.taskId,
        {
          dispatcherId,
          leaseToken: task.leaseToken,
          leaseSeconds: 60,
        },
        `${dispatcherId}:renew:${task.taskId}:${Date.now()}`,
      );
    },
    ack: async (task, result) => {
      await backend.ackTask(
        task.taskId,
        {
          dispatcherId,
          leaseToken: task.leaseToken,
          result,
        },
        `${dispatcherId}:ack:${task.taskId}`,
      );
    },
    nack: async (task, errorCode) => {
      await backend.nackTask(
        task.taskId,
        {
          dispatcherId,
          leaseToken: task.leaseToken,
          errorCode,
          retryAfterSeconds: 10,
        },
        `${dispatcherId}:nack:${task.taskId}`,
      );
    },
  };
  for (;;) {
    const dispatched = await dispatchOnce(dependencies).catch(() => false);
    if (!dispatched) await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error(
      "Walkaround dispatcher stopped:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exitCode = 1;
  });
}
