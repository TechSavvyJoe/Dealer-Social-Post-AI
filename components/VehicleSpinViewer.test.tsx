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
  it("resets angle and zoom for a different project with the same number of frames", () => {
    const { rerender } = render(
      <VehicleSpinViewer
        frames={["/a.jpg", "/b.jpg"]}
        title="First"
        projectKey="first"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next angle" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    rerender(
      <VehicleSpinViewer
        frames={["/c.jpg", "/d.jpg"]}
        title="Second"
        projectKey="second"
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "/c.jpg");
    expect(screen.getByRole("img").style.transform).toContain("scale(1)");
  });
  it("captures modified wheel zoom without consuming normal page scrolling", () => {
    render(<VehicleSpinViewer frames={["/a.jpg"]} title="Vehicle" />);
    const view = screen.getByRole("group");
    const zoom = new WheelEvent("wheel", {
      deltaY: -100,
      ctrlKey: true,
      cancelable: true,
    });
    fireEvent(view, zoom);
    expect(zoom.defaultPrevented).toBe(true);
    expect(screen.getByRole("img").style.transform).toContain("scale(1.15)");
    const scroll = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
    fireEvent(view, scroll);
    expect(scroll.defaultPrevented).toBe(false);
  });
});
