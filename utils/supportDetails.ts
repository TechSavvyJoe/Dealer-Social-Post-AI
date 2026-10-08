/** Support receipts never copy exception text, credentials, or customer URLs. */
export function supportDetails(
  error: Error,
  release: string,
  hash: string,
  now = new Date(),
): string {
  const kind = new Set([
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "URIError",
    "EvalError",
    "AbortError",
    "TimeoutError",
  ]).has(error.name)
    ? error.name
    : "RenderError";
  const frames =
    (error.stack || "").match(/\/assets\/[A-Za-z0-9_.-]+\.js:\d+:\d+/g) || [];
  return [
    "Dealer Social Post AI support receipt",
    "Event: app.render.crash",
    `Error type: ${kind}`,
    `Release: ${/^[a-f0-9]{7,40}$/i.test(release) ? release : "development"}`,
    `Area: ${hash.startsWith("#/spin/") ? "customer vehicle view" : "workspace"}`,
    `When: ${now.toISOString()}`,
    ...Array.from(new Set(frames))
      .slice(0, 8)
      .map((frame) => `Bundle location: ${frame}`),
    "Customer details and private links are excluded.",
  ].join("\n");
}
