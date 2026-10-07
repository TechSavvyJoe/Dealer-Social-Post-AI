import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomScenarioManager } from "../components/CustomScenarioManager";

/**
 * The custom post types editor as it sits in Creative's "Video and advanced"
 * panel: a heading at the level of its sibling groups, and copy that names
 * where a custom type shows now that the showroom picker is gone.
 */
describe("custom scenarios in the settings layout", () => {
  it("titles the group with an h4 that names its region, like its siblings", () => {
    render(<CustomScenarioManager onSave={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 4, name: "Custom scenarios" });
    expect(heading).toHaveClass("text-lg", "leading-6");
    expect(screen.getByRole("region", { name: "Custom scenarios" })).toContainElement(
      heading,
    );
  });

  it("says the blurb shows on the Home tile, not the retired picker", () => {
    render(<CustomScenarioManager onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add scenario" }));
    expect(screen.getByLabelText("Short blurb (shown on the Home tile)")).toBeVisible();
    expect(screen.queryByText(/picker/i)).toBeNull();
  });
});
