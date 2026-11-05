import { describe, expect, it, vi } from "vitest";
import {
  inspectStagedDeployment,
  validateStagedDeploymentInspection,
} from "../scripts/stagedVercelDeployment.mjs";

const identity = {
  expectedUrl: "https://dealer-social-post-ai-abc123.vercel.app",
  expectedProjectId: "prj_expected",
  expectedProjectName: "dealer-social-post-ai",
  expectedDeploymentId: "dpl_abc123",
  expectedOrgId: "team_expected",
};
const inspected = (readyState: string, overrides: Record<string, unknown> = {}) => ({
  id: "dpl_abc123",
  url: "dealer-social-post-ai-abc123.vercel.app",
  projectId: "prj_expected",
  ownerId: "team_expected",
  name: "dealer-social-post-ai",
  target: "production",
  readyState,
  ...overrides,
});

describe("staged Vercel deployment polling contract", () => {
  it("accepts a pending state and then the exact immutable deployment when ready", () => {
    expect(validateStagedDeploymentInspection(inspected("BUILDING"), identity)).toEqual(
      {
        state: "BUILDING",
        id: "dpl_abc123",
      },
    );
    expect(validateStagedDeploymentInspection(inspected("READY"), identity)).toEqual({
      state: "READY",
      id: "dpl_abc123",
    });
  });

  it.each(["ERROR", "CANCELED"])(
    "fails immediately on terminal state %s",
    (readyState) => {
      expect(() =>
        validateStagedDeploymentInspection(inspected(readyState), identity),
      ).toThrow(`terminal state ${readyState}`);
    },
  );

  it.each([
    { projectId: "prj_other" },
    { projectId: undefined },
    { ownerId: "team_other" },
    { ownerId: undefined },
    { name: "other-project" },
    { target: "preview" },
    { url: "other-deployment.vercel.app" },
    { id: "invalid" },
    { id: "dpl_other" },
  ])(
    "rejects an inspection that does not match the staged project and URL: %o",
    (override) => {
      expect(() =>
        validateStagedDeploymentInspection(inspected("READY", override), identity),
      ).toThrow("exact staged deployment identity");
    },
  );

  it("reads the authenticated API with exact deployment and team scope", () => {
    const run = vi
      .fn()
      .mockReturnValue({ status: 0, stdout: JSON.stringify(inspected("READY")) });
    expect(
      inspectStagedDeployment(
        { ...identity, cliVersion: "58.4.4", timeoutMs: 20_000 },
        run,
      ),
    ).toEqual({
      state: "READY",
      id: "dpl_abc123",
    });
    expect(run).toHaveBeenCalledWith(
      "npx",
      [
        "--yes",
        "vercel@58.4.4",
        "api",
        "/v13/deployments/dpl_abc123?teamId=team_expected",
        "--method",
        "GET",
        "--raw",
      ],
      { encoding: "utf8", timeout: 20_000, maxBuffer: 2 * 1024 * 1024 },
    );
  });

  it("rejects the actual reduced CLI inspect shape instead of mistaking it for ownership proof", () => {
    const {
      projectId: _project,
      ownerId: _owner,
      ...cliInspection
    } = inspected("READY");
    const run = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        ...cliInspection,
        createdAt: 1791849748996,
        aliases: [],
        builds: [],
        contextName: "test-team",
      }),
    });
    expect(() =>
      inspectStagedDeployment(
        { ...identity, cliVersion: "58.4.4", timeoutMs: 20_000 },
        run,
      ),
    ).toThrow("exact staged deployment identity");
  });

  it.each([
    { status: 1, stdout: JSON.stringify(inspected("READY")) },
    {
      status: 0,
      error: new Error("timeout"),
      stdout: JSON.stringify(inspected("READY")),
    },
    { status: 0, stdout: "not json" },
  ])("fails closed on transport and malformed responses", (response) => {
    expect(() =>
      inspectStagedDeployment(
        { ...identity, cliVersion: "58.4.4", timeoutMs: 20_000 },
        vi.fn().mockReturnValue(response),
      ),
    ).toThrow();
  });

  it.each([0, -1, NaN, Infinity, 300_001])(
    "rejects an unbounded or invalid timeout %s before invoking Vercel",
    (timeoutMs) => {
      const run = vi.fn();
      expect(() =>
        inspectStagedDeployment({ ...identity, cliVersion: "58.4.4", timeoutMs }, run),
      ).toThrow("Invalid staged inspection request");
      expect(run).not.toHaveBeenCalled();
    },
  );
});
