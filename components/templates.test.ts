import { describe, expect, it } from "vitest";
import {
  POST_TEMPLATES,
  renderPostTemplate,
  replaceCustomerIdentity,
} from "./templates";

describe("caption template identity binding", () => {
  it("resolves every placeholder from the current customer and dealership", () => {
    const rendered = renderPostTemplate(POST_TEMPLATES[0].content, {
      customerName: "Beth",
      dealershipName: "Bob Maxey Ford of Howell",
    });

    expect(rendered).toContain("Beth");
    expect(rendered).not.toContain("[Customer Name]");
    expect(rendered).toContain("Bob Maxey Ford of Howell family");
    expect(rendered).toContain("#BobMaxeyFordOfHowell");
    expect(rendered).not.toContain("#Bob Maxey");
  });

  it("rebinds the exact old identity without changing partial words", () => {
    expect(
      replaceCustomerIdentity(
        "Congrats, Ann! This announcement is for Ann's new ride.",
        "Ann",
        "Beth",
      ),
    ).toBe("Congrats, Beth! This announcement is for Beth's new ride.");
  });
});
