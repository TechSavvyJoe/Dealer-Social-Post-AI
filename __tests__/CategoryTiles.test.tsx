import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryTiles } from "../components/home/CategoryTiles";
import type { HomeTile } from "../services/storeDefaults";

const TILES: HomeTile[] = [
  {
    categoryId: "deliveries",
    label: "Delivery",
    blurb: "Customer + their new car",
    scenarioId: "customer_delivery",
  },
  {
    categoryId: "inventory",
    label: "New arrival",
    blurb: "Fresh on the lot",
    scenarioId: "new_arrival",
  },
  {
    categoryId: "team",
    label: "Team",
    blurb: "People of the store",
    scenarioId: "team_anniversary",
  },
];

type Listener = () => void;

/** A matchMedia stub whose phone answer can be flipped after render. */
const installViewport = (phone: boolean) => {
  const state = { phone, listeners: new Set<Listener>() };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      get matches() {
        return query === "(max-width: 767px)" ? state.phone : false;
      },
      media: query,
      addEventListener: (_: string, listener: Listener) =>
        state.listeners.add(listener),
      removeEventListener: (_: string, listener: Listener) =>
        state.listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
  return {
    setPhone(next: boolean) {
      state.phone = next;
      act(() => state.listeners.forEach((listener) => listener()));
    },
    listenerCount: () => state.listeners.size,
  };
};

const renderTiles = (props: Partial<React.ComponentProps<typeof CategoryTiles>> = {}) =>
  render(<CategoryTiles tiles={TILES} onFile={vi.fn()} {...props} />);

describe("CategoryTiles", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });

  it("names each tile for what it does on a phone and opens that tile's camera", () => {
    installViewport(true);
    renderTiles();

    for (const label of ["Delivery", "New arrival", "Team"]) {
      expect(
        screen.getByRole("button", { name: `${label}: take a photo` }),
      ).toBeInTheDocument();
    }

    const camera = screen.getByLabelText("Take a photo for New arrival");
    const library = screen.getByLabelText("Choose a photo for New arrival");
    const cameraClick = vi.spyOn(camera, "click");
    const libraryClick = vi.spyOn(library, "click");
    fireEvent.click(screen.getByRole("button", { name: "New arrival: take a photo" }));

    expect(cameraClick).toHaveBeenCalledTimes(1);
    expect(libraryClick).not.toHaveBeenCalled();
  });

  it("opens the file picker on wider screens and says so", () => {
    installViewport(false);
    renderTiles();

    const camera = screen.getByLabelText("Take a photo for Delivery");
    const library = screen.getByLabelText("Choose a photo for Delivery");
    const cameraClick = vi.spyOn(camera, "click");
    const libraryClick = vi.spyOn(library, "click");
    fireEvent.click(screen.getByRole("button", { name: "Delivery: choose a photo" }));

    expect(libraryClick).toHaveBeenCalledTimes(1);
    expect(cameraClick).not.toHaveBeenCalled();
  });

  it("follows the viewport when it crosses the phone breakpoint", () => {
    const viewport = installViewport(false);
    const { unmount } = renderTiles();
    expect(
      screen.getByRole("button", { name: "Team: choose a photo" }),
    ).toBeInTheDocument();

    viewport.setPhone(true);
    expect(
      screen.getByRole("button", { name: "Team: take a photo" }),
    ).toBeInTheDocument();

    unmount();
    expect(viewport.listenerCount()).toBe(0);
  });

  it("keeps the hidden file inputs out of the tab and screen-reader order", () => {
    installViewport(true);
    const { container } = renderTiles();

    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    );
    expect(inputs).toHaveLength(TILES.length * 2);
    for (const input of inputs) {
      expect(input.tabIndex).toBe(-1);
      expect(input).toHaveAttribute("aria-hidden", "true");
    }
    // The tile is the only control: no per-tile library button any more.
    expect(screen.getAllByRole("button")).toHaveLength(TILES.length);
    expect(screen.queryByRole("button", { name: /library/i })).toBeNull();
  });

  it("renders each input only at its own breakpoint", () => {
    installViewport(true);
    renderTiles();

    // jsdom has no media queries, so pin the breakpoint classes: the camera
    // input is phone-only, the per-tile library input is md and up (phones
    // use Home's single "Choose from library" row).
    for (const { label } of TILES) {
      expect(screen.getByLabelText(`Take a photo for ${label}`)).toHaveClass(
        "md:hidden",
      );
      expect(screen.getByLabelText(`Choose a photo for ${label}`)).toHaveClass(
        "hidden",
        "md:block",
      );
    }
  });

  it("describes each tile with its blurb, and marks the person's usual category", () => {
    installViewport(true);
    renderTiles({ usualCategory: "inventory" });

    expect(
      screen.getByRole("button", { name: "Delivery: take a photo" }),
    ).toHaveAccessibleDescription("Customer + their new car");
    expect(
      screen.getByRole("button", { name: "New arrival: take a photo" }),
    ).toHaveAccessibleDescription("Fresh on the lot Your usual");
  });

  it("assigns a waiting photo instead of opening the camera", () => {
    installViewport(true);
    const onSelect = vi.fn(() => true);
    renderTiles({ photoWaiting: true, onSelect });

    const camera = screen.getByLabelText("Take a photo for Team");
    const cameraClick = vi.spyOn(camera, "click");
    fireEvent.click(screen.getByRole("button", { name: "Team: use this photo" }));

    expect(onSelect).toHaveBeenCalledWith(TILES[2]);
    expect(cameraClick).not.toHaveBeenCalled();
  });

  it("hands the picked file to onFile with its tile", () => {
    installViewport(true);
    const onFile = vi.fn();
    renderTiles({ onFile });
    const file = new File(["x"], "car.jpg", { type: "image/jpeg" });

    fireEvent.change(screen.getByLabelText("Take a photo for Delivery"), {
      target: { files: [file] },
    });

    expect(onFile).toHaveBeenCalledWith(file, TILES[0]);
  });

  it("marks the grid busy and disables the tiles while a photo is processed", () => {
    installViewport(true);
    const { container, rerender } = renderTiles({ disabled: true });
    const grid = container.firstElementChild as HTMLElement;

    expect(grid).toHaveAttribute("aria-busy", "true");
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }

    rerender(<CategoryTiles tiles={TILES} onFile={vi.fn()} disabled={false} />);
    expect(grid).not.toHaveAttribute("aria-busy");
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeEnabled();
    }
  });

  it("falls back to the category icon when a tile photo cannot load", () => {
    installViewport(true);
    const { container } = renderTiles();
    expect(screen.queryAllByTestId("tile-photo-fallback")).toHaveLength(0);

    const firstPhoto = container.querySelector("img") as HTMLImageElement;
    expect(firstPhoto).toHaveAttribute("src", "/category/deliveries.webp");
    fireEvent.error(firstPhoto);

    expect(screen.getAllByTestId("tile-photo-fallback")).toHaveLength(1);
    expect(container.querySelectorAll("img")).toHaveLength(TILES.length - 1);
  });

  it("uses the flat Light Table tile: no stripe, icon chip, lift, zoom or eyebrow", () => {
    installViewport(true);
    const { container } = renderTiles();
    const markup = container.innerHTML;

    expect(markup).not.toMatch(/translate-y|scale-\[|group-hover:scale/);
    expect(markup).not.toMatch(/bg-brand-fill|bg-brand-tint/);
    expect(markup).not.toMatch(/uppercase|tracking-/);
    expect(markup).not.toMatch(/duration-320/);
    // Photos only until one fails: no decorative icon beside each title.
    expect(container.querySelectorAll("svg")).toHaveLength(0);
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toMatch(/\brounded-md\b/);
      expect(button.className).toMatch(/\bhover:border-strong\b/);
    }
  });
});
