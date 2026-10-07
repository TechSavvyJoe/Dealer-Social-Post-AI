import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBanner } from "../components/ui/ErrorBanner";

const classesOf = (element: HTMLElement) => element.className.split(/\s+/);

describe("ErrorBanner", () => {
  it("shows the message at 14 px, never 12 px", () => {
    render(<ErrorBanner message="Couldn't load your posts." />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load your posts.");
    expect(classesOf(alert)).toContain("text-sm");
    expect(classesOf(alert)).not.toContain("text-xs");
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
  });

  it("gives the retry a 44 px, 14 px target that calls its handler once", () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="Couldn't load your posts." onRetry={onRetry} />);
    const action = screen.getByRole("button", { name: "Try again" });

    expect(classesOf(action)).toEqual(
      expect.arrayContaining(["min-h-11", "text-sm", "text-error-ink"]),
    );
    // The Button's own small size and ghost ink must not survive the override.
    expect(classesOf(action)).not.toContain("min-h-[36px]");
    expect(classesOf(action)).not.toContain("text-ink-2");
    expect(action).toHaveAttribute("type", "button");
    // The refresh glyph is decoration; the label is the accessible name.
    expect(action.querySelector("svg")).not.toBeNull();

    fireEvent.click(action);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("names a clear-only action Dismiss, without the retry glyph", () => {
    const onDismiss = vi.fn();
    render(
      <ErrorBanner
        message="That file isn't a photo."
        onRetry={onDismiss}
        actionLabel="Dismiss"
      />,
    );
    const action = screen.getByRole("button", { name: "Dismiss" });
    expect(classesOf(action)).toContain("min-h-11");
    expect(action.querySelector("svg")).toBeNull();

    fireEvent.click(action);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the banner one line tall: the target's margin cancels the padding", () => {
    render(
      <ErrorBanner message="Couldn't load your posts." onRetry={() => undefined} />,
    );
    const alert = screen.getByRole("alert");
    const action = screen.getByRole("button", { name: "Try again" });
    // 12 px padding each side + a 20 px line = 44 px inside the banner, and the
    // 44 px target pulls back exactly 12 px each side, so it adds no height.
    expect(classesOf(alert)).toContain("py-3");
    expect(classesOf(action)).toEqual(expect.arrayContaining(["-my-3", "self-center"]));
  });
});
