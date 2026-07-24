import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type ProviderResource = {
  provider: "gemini" | "vertex";
  resource_type: "operation" | "file";
  resource_id: string;
};

type Policies = {
  isAllowedProxyPath(path: string): boolean;
  providerOperationStartProvider(path: string, method: string): string | null;
  providerResourceRequest(path: string, method: string): ProviderResource | null;
  providerResourcesFromResponse(path: string, response: unknown): ProviderResource[];
};

function loadPolicies(): Policies {
  const source = readFileSync(
    resolve(process.cwd(), "pb_hooks/requestPolicies.js"),
    "utf8",
  );
  const module = { exports: {} as Policies };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

const policies = loadPolicies();
const startPath = "v1beta/models/veo-3.1-generate-preview:predictLongRunning";

describe("durable provider resource ownership policy", () => {
  it("canonicalizes Veo operation polls and Gemini file downloads", () => {
    expect(policies.providerOperationStartProvider(startPath, "POST")).toBe("gemini");
    expect(
      policies.providerResourceRequest("v1beta/operations/job_123", "GET"),
    ).toEqual({
      provider: "gemini",
      resource_type: "operation",
      resource_id: "operations/job_123",
    });
    expect(
      policies.providerResourceRequest(
        "v1beta/models/veo-3.1-generate-preview/operations/job_456",
        "GET",
      ),
    ).toEqual({
      provider: "gemini",
      resource_type: "operation",
      resource_id: "models/veo-3.1-generate-preview/operations/job_456",
    });
    expect(
      policies.providerResourceRequest(
        "v1beta/files/generated-video_789:download",
        "GET",
      ),
    ).toEqual({
      provider: "gemini",
      resource_type: "file",
      resource_id: "files/generated-video_789",
    });
    expect(
      policies.providerResourceRequest(
        "v1beta/files/generated-video_789:download",
        "POST",
      ),
    ).toBeNull();
  });

  it("extracts only operation names and trusted provider file URI fields", () => {
    expect(
      policies.providerResourcesFromResponse(startPath, {
        name: "models/veo-3.1-generate-preview/operations/job_456",
        response: {
          generateVideoResponse: {
            generatedSamples: [
              {
                video: {
                  uri: "https://generativelanguage.googleapis.com/v1beta/files/generated-video_789:download?alt=media",
                },
              },
            ],
          },
          echoedText:
            "https://generativelanguage.googleapis.com/v1beta/files/not-a-claim:download",
          attacker: {
            uri: "https://attacker.example/v1beta/files/stolen:download",
          },
        },
      }),
    ).toEqual([
      {
        provider: "gemini",
        resource_type: "operation",
        resource_id: "models/veo-3.1-generate-preview/operations/job_456",
      },
      {
        provider: "gemini",
        resource_type: "file",
        resource_id: "files/generated-video_789",
      },
    ]);
  });

  it("keeps disabled Vertex paths denied while defining a future-safe key", () => {
    const vertexPoll =
      "vertex/v1/projects/project-a/locations/us-central1/operations/job_1";
    expect(policies.isAllowedProxyPath(vertexPoll)).toBe(false);
    expect(policies.providerResourceRequest(vertexPoll, "GET")).toEqual({
      provider: "vertex",
      resource_type: "operation",
      resource_id: "projects/project-a/locations/us-central1/operations/job_1",
    });
  });

  it("checks ownership before upstream I/O and persists discovered IDs", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const helpers = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");
    const ownershipCheck = hook.indexOf("helpers.dealerOwnsProviderResource(");
    const upstreamSend = hook.indexOf("$http.send({", ownershipCheck);
    const durableClaim = hook.indexOf("helpers.claimProviderResources(");

    expect(ownershipCheck).toBeGreaterThan(-1);
    expect(ownershipCheck).toBeLessThan(upstreamSend);
    expect(durableClaim).toBeGreaterThan(upstreamSend);
    expect(hook).toContain('error: "Unauthorized proxy request"');
    expect(hook).toContain('error: "Provider resource access denied"');
    expect(helpers).toContain('"provider_resources"');
    expect(helpers).toContain("PROVIDER_RESOURCE_TTL_SECONDS");
  });

  it("locks the ledger and uniquely binds each provider identifier", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "pb_migrations/1750300300_create_provider_resources.js"),
      "utf8",
    );
    expect(migration).toContain('name: "provider_resources"');
    expect(migration).toContain("idx_provider_resources_identity");
    expect(migration).toContain('name: "expires_at"');
    expect(migration).toContain("listRule: null");
    expect(migration).toContain("viewRule: null");
    expect(migration).toContain("createRule: null");
  });
});
