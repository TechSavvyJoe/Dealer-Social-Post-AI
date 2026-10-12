import { describe, expect, it } from "vitest";
import { validateStagedDeploymentInspection } from "../scripts/stagedVercelDeployment.mjs";

const identity = {
  expectedUrl: "https://dealer-social-post-ai-abc123.vercel.app",
  expectedProjectId: "prj_expected",
  expectedProjectName: "dealer-social-post-ai",
  expectedDeploymentId: "dpl_abc123",
};
const inspected = (readyState: string, overrides: Record<string, unknown> = {}) => ({
  id: "dpl_abc123",
  url: "dealer-social-post-ai-abc123.vercel.app",
  projectId: "prj_expected",
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
});
