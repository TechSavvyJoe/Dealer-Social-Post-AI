/** Bound both the fetch and its response body; always detach caller listeners. */
export async function withRequestDeadline<T>(
  signal: AbortSignal | null | undefined,
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException(
          "The connection took too long. Check your connection and try again.",
          "TimeoutError",
        ),
      ),
    timeoutMs,
  );
  try {
    controller.signal.throwIfAborted();
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
