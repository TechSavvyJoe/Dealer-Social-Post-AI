import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthenticatedClient } from "../scripts/production-provider-canary.mjs";

const scriptPath = resolve(process.cwd(), "scripts/production-provider-canary.mjs");

describe("production provider canary", () => {
  it("executes its canonical model and synthetic-media contract without credentials", () => {
    expect(
      execFileSync(process.execPath, [scriptPath, "--contract-check"], {
        encoding: "utf8",
      }),
    ).toContain("Provider canary contract is valid");
  });

  it("keeps provider query material and generated content out of evidence", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain("?alt=media");
    expect(source).toContain('providerUrl.pathname.endsWith(":download")');
    expect(source).not.toContain("providerUrl.search");
    expect(source).not.toContain("RELEASE_CANARY_ADMIN_CODE");

    const evidenceStart = source.indexOf("const evidence = {");
    const evidenceEnd = source.indexOf("let primaryError", evidenceStart);
    const evidenceShape = source.slice(evidenceStart, evidenceEnd);
    for (const sensitiveField of [
      "adminCode",
      "personPin",
      "cookie",
      "prompt",
      "captionText",
      "operationName",
      "fileUri",
      "imageBase64",
    ]) {
      expect(evidenceShape).not.toContain(sensitiveField);
    }
  });

  it("refuses to send the canary credential to an arbitrary HTTPS origin", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        RELEASE_CANARY_BASE_URL: "https://untrusted.example",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CONFIG_UNTRUSTED_ORIGIN");
  });

  it("proves logout by replaying the revoked cookie and requiring it to be cleared", async () => {
    const seen: Array<{ method?: string; cookie?: string }> = [];
    const server = createServer((request, response) => {
      seen.push({ method: request.method, cookie: request.headers.cookie });
      if (request.method === "DELETE") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"success":true}');
        return;
      }
      response.writeHead(401, {
        "content-type": "application/json",
        "set-cookie":
          "dealer_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
      });
      response.end('{"error":"Invalid session"}');
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing test port");
      const client = new AuthenticatedClient(`http://127.0.0.1:${address.port}`);
      client.cookie = "dealer_session=opaque-canary-session";
      await client.logout();
      expect(client.cookie).toBe("");
      expect(seen).toEqual([
        { method: "DELETE", cookie: "dealer_session=opaque-canary-session" },
        { method: "GET", cookie: "dealer_session=opaque-canary-session" },
      ]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  });

  it("fails revocation evidence when a 200 logout leaves the old cookie usable", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"role":"salesperson"}');
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing test port");
      const client = new AuthenticatedClient(`http://127.0.0.1:${address.port}`);
      client.cookie = "dealer_session=opaque-canary-session";
      await expect(client.logout()).rejects.toMatchObject({
        code: "REVOCATION_PROBE_FAILED",
      });
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  });
});
