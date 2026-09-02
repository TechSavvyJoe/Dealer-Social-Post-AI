type Task<T> = (signal: AbortSignal) => Promise<T>;

interface QueueOptions {
  maxRetries?: number;
  delayMs?: number;
  timeoutMs?: number;
  /** Optional caller-owned cancellation, forwarded into the active task. */
  signal?: AbortSignal;
}

type ResolvedQueueOptions = Required<Omit<QueueOptions, "signal">> & {
  signal?: AbortSignal;
};

const DEFAULT_OPTIONS: Required<Omit<QueueOptions, "signal">> = {
  maxRetries: 2,
  delayMs: 750,
  timeoutMs: 300000, // 5 minutes safety timeout to match proxy
};

let active = false;
const queue: Array<{
  task: Task<unknown>;
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  options: ResolvedQueueOptions;
}> = [];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const abortError = (reason?: unknown): Error => {
  if (reason instanceof Error) return reason;
  return new DOMException("Task aborted", "AbortError");
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";

const runNext = async () => {
  if (active) return;
  const next = queue.shift();
  if (!next) return;

  active = true;
  const { task, resolve, reject, options } = next;

  let attempt = 0;
  while (attempt <= options.maxRetries) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutError = new Error("Task timed out");
    timeoutError.name = "TimeoutError";

    const taskOutcome = Promise.resolve()
      .then(() => task(controller.signal))
      .then(
        (value) => ({ kind: "success" as const, value }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutOutcome = new Promise<{ kind: "timeout" }>((resolveTimeout) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        // Abort with the platform-native AbortError so every fetch/fallback
        // layer recognizes cancellation and stops immediately. The caller
        // still receives the more specific TimeoutError below.
        controller.abort();
        resolveTimeout({ kind: "timeout" });
      }, options.timeoutMs);
    });

    let detachExternalAbort: () => void = () => undefined;
    const externalAbortOutcome = new Promise<{ kind: "aborted"; error: Error }>(
      (resolveAbort) => {
        const externalSignal = options.signal;
        if (!externalSignal) return;

        const handleAbort = () => {
          const error = abortError(externalSignal.reason);
          controller.abort();
          resolveAbort({ kind: "aborted", error });
        };

        if (externalSignal.aborted) {
          handleAbort();
          return;
        }

        externalSignal.addEventListener("abort", handleAbort, { once: true });
        detachExternalAbort = () =>
          externalSignal.removeEventListener("abort", handleAbort);
      },
    );

    const outcome = await Promise.race([
      taskOutcome,
      timeoutOutcome,
      externalAbortOutcome,
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    detachExternalAbort();

    if (outcome.kind === "success") {
      resolve(outcome.value);
      active = false;
      await runNext();
      return;
    }

    if (outcome.kind === "timeout" || outcome.kind === "aborted") {
      // Reject the caller immediately, but do not release the queue until the
      // aborted task settles. This preserves the one-at-a-time guarantee even
      // when a future consumer accidentally ignores its AbortSignal.
      reject(outcome.kind === "timeout" ? timeoutError : outcome.error);
      await taskOutcome;
      active = false;
      await runNext();
      return;
    }

    const error = timedOut ? timeoutError : outcome.error;
    attempt += 1;
    if (timedOut || isAbortError(error) || attempt > options.maxRetries) {
      reject(error);
      active = false;
      await runNext();
      return;
    }
    const backoff = options.delayMs * attempt;
    await sleep(backoff);
  }
};

export const enqueueTask = <T>(task: Task<T>, opts?: QueueOptions): Promise<T> => {
  const options: ResolvedQueueOptions = {
    maxRetries: opts?.maxRetries ?? DEFAULT_OPTIONS.maxRetries,
    delayMs: opts?.delayMs ?? DEFAULT_OPTIONS.delayMs,
    timeoutMs: opts?.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs,
    signal: opts?.signal,
  };

  return new Promise<T>((resolve, reject) => {
    queue.push({ task, resolve, reject, options });
    void runNext();
  });
};

export const clearQueue = () => {
  // Reject every pending (not-yet-started) task so callers awaiting them don't
  // hang forever. We deliberately do NOT reset `active`: the task currently
  // running owns that flag and resets it when it settles. Forcing it to false
  // here would let runNext() start a second task concurrently with the live one.
  const pending = queue.splice(0, queue.length);
  pending.forEach((entry) => {
    try {
      entry.reject(new Error("Request queue cleared"));
    } catch {
      /* ignore */
    }
  });
};
