import { createServer } from "node:http";

const port = Number(process.env.PROVIDER_STUB_PORT || 18081);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("PROVIDER_STUB_PORT must be an unprivileged TCP port.");
}

const server = createServer((request, response) => {
  if (request.url === "/ready") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  let bodyBytes = 0;
  request.on("data", (chunk) => {
    bodyBytes += chunk.length;
    if (bodyBytes > 64 * 1024) request.destroy();
  });
  request.on("end", () => {
    response.writeHead(429, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify({
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "Synthetic provider failure",
        },
      }),
    );
  });
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`provider stub listening on ${port}\n`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
