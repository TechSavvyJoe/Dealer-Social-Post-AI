import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { describe, expect, it, vi } from "vitest";

import { dispatchOnce, type DispatcherDependencies } from "./dispatcher.js";

const task = {
  taskId: "task-1",
  leaseToken: "lease-token-123456789",
  kind: "produce" as const,
  idempotencyKey: "walkaround-producer-project-1-r1",
  input: {
    projectId: "project-1",
    workflowId: "walkaround-producer-project-1-r1",
    expectedRevision: 2,
  },
};

function dependencies(): DispatcherDependencies {
  return {
    claim: vi.fn().mockResolvedValue(task),
    start: vi.fn().mockResolvedValue({ runId: "run-1" }),
    executeReviewValidation: vi.fn().mockResolvedValue({ passed: true }),
    executeDeletion: vi.fn().mockResolvedValue({ deletedObjectCount: 1 }),
    renew: vi.fn().mockResolvedValue(undefined),
    ack: vi.fn().mockResolvedValue(undefined),
    nack: vi.fn().mockResolvedValue(undefined),
  };
}

describe("walkaround task dispatcher", () => {
  it("acks only after deterministic Temporal start succeeds", async () => {
    const deps = dependencies();
    await expect(dispatchOnce(deps)).resolves.toBe(true);
    expect(deps.start).toHaveBeenCalledWith(task);
    expect(deps.ack).toHaveBeenCalledWith(task, { temporalRunId: "run-1" });
    expect(deps.nack).not.toHaveBeenCalled();
  });

  it("treats an already-started workflow ID as success", async () => {
    const deps = dependencies();
    vi.mocked(deps.start).mockRejectedValue(
      new WorkflowExecutionAlreadyStartedError(
        "already started",
        task.input.workflowId,
        "workflow-type",
      ),
    );
    await expect(dispatchOnce(deps)).resolves.toBe(true);
    expect(deps.ack).toHaveBeenCalledWith(task, { temporalRunId: "already-started" });
    expect(deps.nack).not.toHaveBeenCalled();
  });

  it("nacks retryably when Temporal start fails", async () => {
    const deps = dependencies();
    vi.mocked(deps.start).mockRejectedValue(new Error("unavailable"));
    await expect(dispatchOnce(deps)).rejects.toThrow(/unavailable/);
    expect(deps.nack).toHaveBeenCalledWith(task, "TASK_EXECUTION_FAILED");
  });

  it("executes exact deletion targets without starting a third workflow", async () => {
    const deps = dependencies();
    const deletionTask = {
      ...task,
      kind: "delete_objects" as const,
      deletion: {
        scope: "asset" as const,
        objects: [{ storageKey: "walkarounds/dealer/project/sources/asset-1" }],
      },
    };
    vi.mocked(deps.claim).mockResolvedValue(deletionTask);
    await expect(dispatchOnce(deps)).resolves.toBe(true);
    expect(deps.executeDeletion).toHaveBeenCalledWith(deletionTask);
    expect(deps.start).not.toHaveBeenCalled();
  });

  it("renews long task leases and refuses to ack after lease renewal fails", async () => {
    vi.useFakeTimers();
    const deps = dependencies();
    const deletionTask = {
      ...task,
      kind: "delete_objects" as const,
      deletion: {
        scope: "project" as const,
        objects: [{ storageKey: "walkarounds/dealer/project/master.mp4" }],
      },
    };
    const resolvers: Array<(value: unknown) => void> = [];
    const pending = new Promise<unknown>((resolve) => resolvers.push(resolve));
    vi.mocked(deps.claim).mockResolvedValue(deletionTask);
    vi.mocked(deps.executeDeletion).mockReturnValue(pending);
    vi.mocked(deps.renew).mockRejectedValue(new Error("lease lost"));
    const dispatched = dispatchOnce(deps);
    await vi.advanceTimersByTimeAsync(20_001);
    resolvers[0]({ deletedObjectCount: 1 });
    await expect(dispatched).rejects.toThrow(/lease lost/);
    expect(deps.ack).not.toHaveBeenCalled();
    expect(deps.nack).toHaveBeenCalledWith(deletionTask, "TASK_EXECUTION_FAILED");
    vi.useRealTimers();
  });
});
