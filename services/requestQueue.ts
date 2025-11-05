type Task<T> = () => Promise<T>;

interface QueueOptions {
  maxRetries?: number;
  delayMs?: number;
}

const DEFAULT_OPTIONS: Required<QueueOptions> = {
  maxRetries: 2,
  delayMs: 750,
};

let active = false;
const queue: Array<{
  task: Task<unknown>;
  resolve: (value: unknown) => void;
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
      const result = await task();
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
  };

  return new Promise<T>((resolve, reject) => {
    queue.push({ task, resolve, reject, options });
    void runNext();
  });
};

export const clearQueue = () => {
  queue.splice(0, queue.length);
  active = false;
};
