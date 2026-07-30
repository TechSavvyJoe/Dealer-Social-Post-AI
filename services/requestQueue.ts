type Task<T> = (signal?: AbortSignal) => Promise<T>;

interface QueueOptions {
  maxRetries?: number;
  delayMs?: number;
  timeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<QueueOptions> = {
  maxRetries: 2,
  delayMs: 750,
  timeoutMs: 300000, // 5 minutes safety timeout to match proxy
};

let active = false;
const queue: Array<{
  task: Task<unknown>;
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  options: Required<QueueOptions>;
}> = [];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runNext = async () => {
  if (active) return;
  const next = queue.shift();
  if (!next) return;

  active = true;
  const { task, resolve, reject, options } = next;

  let attempt = 0;
  while (attempt <= options.maxRetries) {
    try {
      const controller = new AbortController();
      const result = await new Promise((resolveTask, rejectTask) => {
        const timer = setTimeout(() => {
          controller.abort();
          rejectTask(new Error("Task timed out"));
        }, options.timeoutMs);

        task(controller.signal)
          .then((value) => {
            clearTimeout(timer);
            resolveTask(value);
          })
          .catch((err) => {
            clearTimeout(timer);
            rejectTask(err);
          });
      });
      resolve(result);
      active = false;
      await runNext();
      return;
    } catch (error) {
      attempt += 1;
      if (attempt > options.maxRetries) {
        reject(error);
        active = false;
        await runNext();
        return;
      }
      const backoff = options.delayMs * attempt;
      await sleep(backoff);
    }
  }
};

export const enqueueTask = <T>(task: Task<T>, opts?: QueueOptions): Promise<T> => {
  const options: Required<QueueOptions> = {
    maxRetries: opts?.maxRetries ?? DEFAULT_OPTIONS.maxRetries,
    delayMs: opts?.delayMs ?? DEFAULT_OPTIONS.delayMs,
    timeoutMs: opts?.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs,
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
