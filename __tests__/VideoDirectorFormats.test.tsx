import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoDirectorModal } from "../components/VideoDirectorModal";

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
    expect(screen.queryByRole("button", { name: /square/i })).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Golden Delivery/i,
      }),
    );

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

    const qualityButton = screen.getByRole("button", {
      name: /Quality 1080p\. Best detail · fixed at 8s/i,
    });
    fireEvent.click(qualityButton);

    expect(qualityButton).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText(/premium 1080p model and requires an 8-second video/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("8 secondsRequired for 1080p");
    expect(screen.queryByRole("button", { name: "4s" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "6s" })).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Golden Delivery/i,
      }),
    );

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

    expect(
      screen.getByRole("button", { name: /Vertical 9:16 Reels/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "9:16 Vertical" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Music On" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Upbeat" }));
    expect(screen.getByRole("button", { name: "Music On" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Upbeat" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: /Wide 16:9 YouTube/i }));

    expect(
      screen.getByRole("button", { name: /Vertical 9:16 Reels/i }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Wide 16:9 YouTube/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "16:9 Wide" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
