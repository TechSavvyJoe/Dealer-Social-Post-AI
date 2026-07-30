import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLISH_TARGETS } from "../services/publishTargets";

type Helpers = {
  normalizeDealerSocialField: (field: string, value: unknown) => string;
  dealerMutationData: (
    body: Record<string, unknown>,
    allowCode: boolean,
    allowAdminCode: boolean,
  ) => Record<string, unknown>;
};

const loadPocketBaseHelpers = (): Helpers => {
  const source = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");
  const module = { exports: {} as Helpers };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
};

describe("platform contracts at the PocketBase boundary", () => {
  it("keeps every frontend publishing destination in the backend allowlist", () => {
    const source = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const declaration = source.match(
      /const ALLOWED_POST_PLATFORM_IDS = \[([\s\S]*?)\];/,
    );
    expect(declaration?.[1]).toBeTruthy();
    const backendIds = Array.from(
      declaration?.[1].matchAll(/"([^"]+)"/g) ?? [],
      (match) => match[1],
    );

    expect(backendIds).toEqual(PUBLISH_TARGETS.map((target) => target.id));
  });

  it("persists canonical platform-valid social identities", () => {
    const helpers = loadPocketBaseHelpers();

    expect(
      helpers.normalizeDealerSocialField(
        "facebook_page_tag",
        "  @Bob Maxey\nFord of Howell  ",
      ),
    ).toBe("Bob Maxey Ford of Howell");
    expect(
      helpers.normalizeDealerSocialField("instagram_handle", " @Bob.Maxey_Ford "),
    ).toBe("Bob.Maxey_Ford");
    expect(helpers.normalizeDealerSocialField("x_handle", "@Bob_Maxey")).toBe(
      "Bob_Maxey",
    );

    expect(() =>
      helpers.normalizeDealerSocialField(
        "instagram_handle",
        "https://instagram.com/bobmaxeyford",
      ),
    ).toThrow("Social profiles must be saved as a Page name or handle");
    expect(() =>
      helpers.normalizeDealerSocialField("instagram_handle", "Bob Maxey Ford"),
    ).toThrow(
      "Instagram handle may use only letters, numbers, periods, and underscores",
    );
    expect(() => helpers.normalizeDealerSocialField("x_handle", "Bob.Maxey")).toThrow(
      "X handle may use only letters, numbers, and underscores",
    );

    expect(
      helpers.dealerMutationData(
        {
          facebook_page_tag: " @Bob Maxey Ford of Howell ",
          instagram_handle: "@bobmaxeyford",
          attacker_field: "must not pass",
        },
        false,
        false,
      ),
    ).toEqual({
      facebook_page_tag: "Bob Maxey Ford of Howell",
      instagram_handle: "bobmaxeyford",
    });
  });
});
