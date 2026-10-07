import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChannelChips } from "../components/post/ChannelChips";

describe("ChannelChips", () => {
  it("marks each chip with the 16 px platform glyph, not a resized larger one", () => {
    render(
      <ChannelChips
        channels={[
          { id: "facebook_feed", label: "Facebook" },
          { id: "gbp", label: "Google" },
        ]}
        selectedId="facebook_feed"
        onSelect={vi.fn()}
      />,
    );
    const group = screen.getByRole("group", { name: "Share to" });
    for (const name of ["Facebook", "Google"]) {
      const glyph = within(group)
        .getByRole("button", { name })
        .querySelector("[data-platform-glyph]");
      expect(glyph).toHaveAttribute("aria-hidden", "true");
      const classes = Array.from(glyph?.classList ?? []);
      expect(classes).toContain("size-4");
      // The xs size owns the small mark; no caller override reshapes a bigger tile.
      expect(classes).not.toContain("size-6");
      expect(classes.some((value) => value.includes("shadow"))).toBe(false);
      expect(glyph?.querySelector("svg")).toHaveClass("size-3");
    }
  });
});
