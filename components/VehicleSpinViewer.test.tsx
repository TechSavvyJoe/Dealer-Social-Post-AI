import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VehicleSpinViewer } from "./VehicleSpinViewer";

describe("vehicle spin controls", () => {
  it("rotates both ways, wraps, and resets the zoom", () => {
    render(
      <VehicleSpinViewer
        frames={["/a.jpg", "/b.jpg", "/c.jpg"]}
        title="Test vehicle"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous angle" }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/c.jpg");
    fireEvent.keyDown(screen.getByRole("group"), { key: "ArrowRight" });
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("img").style.transform).toContain("scale(1.25)");
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(screen.getByRole("img").style.transform).toContain("scale(1)");
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
  });
  it("selects an exact angle with the accessible range input", () => {
    render(
      <VehicleSpinViewer
        frames={["/a.jpg", "/b.jpg", "/c.jpg"]}
        title="Test vehicle"
      />,
    );
    fireEvent.change(screen.getByRole("slider", { name: "View angle" }), {
      target: { value: "1" },
    });
    expect(screen.getByRole("img")).toHaveAttribute(
      "alt",
      "Test vehicle, angle 2 of 3",
    );
  });
  it("keeps the selected angle when a background correction replaces frame URLs", () => {
    const { rerender } = render(
      <VehicleSpinViewer frames={["/a.jpg", "/b.jpg", "/c.jpg"]} title="Vehicle" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next angle" }));
    rerender(
      <VehicleSpinViewer
        frames={["/new-a.jpg", "/new-b.jpg", "/new-c.jpg"]}
        title="Vehicle"
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "/new-b.jpg");
  });
});
