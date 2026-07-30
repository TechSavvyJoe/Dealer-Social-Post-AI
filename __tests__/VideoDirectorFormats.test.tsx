import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoDirectorModal } from "../components/VideoDirectorModal";

const getButtonByText = (text: string | RegExp): HTMLButtonElement => {
  const button = screen.getByText(text).closest("button");
  expect(button).toBeInstanceOf(HTMLButtonElement);
  return button as HTMLButtonElement;
};

beforeEach(() => {
  // Modal focus is scheduled on the next frame. Keep that frame off the wall
  // clock so a busy parallel worker cannot turn it into test-order noise.
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
  });
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("VideoDirector truthful formats", () => {
  it("offers only real Veo ratios and defaults to the fast 720p model", () => {
    const onSelectStyle = vi.fn();
    render(
      <VideoDirectorModal
        isOpen
        onClose={vi.fn()}
        onSelectStyle={onSelectStyle}
        defaultAspect="16:9"
      />,
    );

    expect(screen.getAllByText("9:16 Vertical").length).toBeGreaterThan(0);
    expect(screen.getAllByText("16:9 Wide").length).toBeGreaterThan(0);
    expect(screen.queryByText(/square-friendly/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/square/i)).not.toBeInTheDocument();

    fireEvent.click(getButtonByText("Golden Delivery"));

    expect(onSelectStyle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        aspectPreference: "16:9",
        durationSeconds: 6,
        resolution: "720p",
      }),
    );
  });

  it("makes premium 1080p explicit and enforces its required 8-second length", () => {
    const onSelectStyle = vi.fn();
    render(
      <VideoDirectorModal isOpen onClose={vi.fn()} onSelectStyle={onSelectStyle} />,
    );

    const qualityButton = getButtonByText("Quality 1080p");
    fireEvent.click(qualityButton);

    expect(qualityButton).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText(/premium 1080p model and requires an 8-second video/i),
    ).toBeInTheDocument();
    expect(screen.getByText("8 seconds").closest('[role="status"]')).toHaveTextContent(
      "8 secondsRequired for 1080p",
    );
    expect(screen.queryByText("4s")).not.toBeInTheDocument();
    expect(screen.queryByText("6s")).not.toBeInTheDocument();

    fireEvent.click(getButtonByText("Golden Delivery"));

    expect(onSelectStyle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        durationSeconds: 8,
        resolution: "1080p",
      }),
    );
  });

  it("exposes the selected format, aspect ratio, and soundtrack to assistive tech", () => {
    render(
      <VideoDirectorModal
        isOpen
        onClose={vi.fn()}
        onSelectStyle={vi.fn()}
        defaultAspect="9:16"
      />,
    );

    expect(getButtonByText("Vertical 9:16")).toHaveAttribute("aria-pressed", "true");
    expect(getButtonByText("9:16 Vertical")).toHaveAttribute("aria-pressed", "true");
    expect(getButtonByText("Music On")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(getButtonByText("Upbeat"));
    expect(getButtonByText("Music On")).toHaveAttribute("aria-pressed", "false");
    expect(getButtonByText("Upbeat")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(getButtonByText("Wide 16:9"));

    expect(getButtonByText("Vertical 9:16")).toHaveAttribute("aria-pressed", "false");
    expect(getButtonByText("Wide 16:9")).toHaveAttribute("aria-pressed", "true");
    expect(getButtonByText("16:9 Wide")).toHaveAttribute("aria-pressed", "true");
  });

  it("pins an exact platform delivery to its required ratio and quality", () => {
    const onSelectStyle = vi.fn();
    render(
      <VideoDirectorModal
        isOpen
        onClose={vi.fn()}
        onSelectStyle={onSelectStyle}
        defaultAspect="16:9"
        lockedAspect="9:16"
        deliveryLabel="Instagram Reel"
      />,
    );

    expect(screen.getByText("Exact output pinned").parentElement).toHaveTextContent(
      "Instagram Reel · 9:16 · 1080p · 8 seconds",
    );
    expect(getButtonByText("9:16 Vertical")).toBeDisabled();
    expect(getButtonByText("Fast 720p")).toBeDisabled();

    fireEvent.click(getButtonByText("Golden Delivery"));
    expect(onSelectStyle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        aspectPreference: "9:16",
        durationSeconds: 8,
        resolution: "1080p",
      }),
    );
  });
});
