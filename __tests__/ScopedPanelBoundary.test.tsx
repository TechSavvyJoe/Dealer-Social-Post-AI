import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { PanelErrorBoundary } from "../App";

const Panel: React.FC<{ crash: boolean }> = ({ crash }) => {
  if (crash) throw new Error("panel exploded");
  return <p>panel content</p>;
};

describe("PanelErrorBoundary", () => {
  it("keeps the workspace alive when one lazy surface crashes", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onDismiss = vi.fn();

    const { rerender } = render(
      <div>
        <p>Workspace stays mounted</p>
        <PanelErrorBoundary panelName="Settings" onDismiss={onDismiss}>
          <Panel crash />
        </PanelErrorBoundary>
      </div>,
    );

    // The crash is contained: only the panel is replaced, and by a compact
    // inline alert rather than the root boundary's full-screen recovery view.
    expect(screen.getByText("Workspace stays mounted")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Settings could not open");
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();

    // Retrying re-mounts the panel instead of reloading the whole app.
    rerender(
      <div>
        <p>Workspace stays mounted</p>
        <PanelErrorBoundary panelName="Settings" onDismiss={onDismiss}>
          <Panel crash={false} />
        </PanelErrorBoundary>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("panel content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("closes the crashed surface through the owning screen", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onDismiss = vi.fn();

    render(
      <PanelErrorBoundary panelName="My work" onDismiss={onDismiss}>
        <Panel crash />
      </PanelErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("My work could not open");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
