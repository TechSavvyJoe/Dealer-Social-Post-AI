import { FatalError } from "@outputai/core";
import { HTTPError, TimeoutError } from "@outputai/http";
import { describe, expect, it } from "vitest";

import { mapProviderError } from "./http.js";

describe("ambiguous paid provider creates", () => {
  it("fails fatally on a create timeout so Temporal cannot duplicate the job", async () => {
    const error = new TimeoutError(new Request("https://provider.example.test/create"));
    await expect(mapProviderError("Provider", error, true)).rejects.toBeInstanceOf(
      FatalError,
    );
    await expect(mapProviderError("Provider", error, true)).rejects.toThrow(
      /reconciliation/,
    );
  });

  it("fails fatally on an ambiguous 5xx create", async () => {
    const error = () =>
      new HTTPError(
        new Response("accepted state unknown", { status: 500 }),
        new Request("https://provider.example.test/create"),
        {} as never,
      );
    await expect(mapProviderError("Provider", error(), true)).rejects.toBeInstanceOf(
      FatalError,
    );
    await expect(mapProviderError("Provider", error(), true)).rejects.toThrow(
      /ambiguous/,
    );
  });

  it("keeps an explicit 429 retryable because the provider rejected it before acceptance", async () => {
    const error = new HTTPError(
      new Response("rate limited", { status: 429 }),
      new Request("https://provider.example.test/create"),
      {} as never,
    );
    await expect(mapProviderError("Provider", error, true)).rejects.not.toBeInstanceOf(
      FatalError,
    );
  });
});
