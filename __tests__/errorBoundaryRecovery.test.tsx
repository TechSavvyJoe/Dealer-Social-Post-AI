import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../components/ErrorBoundary";

const Boom: React.FC = () => {
  throw new Error("boom");
};

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.classList.remove("theme-light");
});

const renderCrashed = () => {
  // React logs the caught error; keep the test output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  );
};

describe("crash screen", () => {
  it("offers recovery before anything destructive", () => {
    renderCrashed();
    expect(screen.getByRole("heading", { name: /something went wrong/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /refresh page/i })).toBeTruthy();
  });

  it("names the destructive action by what it actually does", () => {
    renderCrashed();
    // "Reset session" sounded harmless; it deletes on-device photos and posts.
    expect(screen.queryByRole("button", { name: /^reset session$/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /sign out and clear this device/i }),
    ).toBeTruthy();
  });

  it("requires a second, explicit confirmation and states the consequence", () => {
    renderCrashed();
    fireEvent.click(
      screen.getByRole("button", { name: /sign out and clear this device/i }),
    );

    // The consequence was previously only in a title attribute, which a phone
    // never shows.
    expect(screen.getByRole("alert").textContent).toMatch(
      /removes photos and posts saved on this device/i,
    );
    expect(screen.getByRole("button", { name: /clear and sign out/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /keep my work/i })).toBeTruthy();
  });

  it("lets the user back out of the confirmation", () => {
    renderCrashed();
    fireEvent.click(
      screen.getByRole("button", { name: /sign out and clear this device/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /keep my work/i }));

    expect(screen.queryByRole("button", { name: /clear and sign out/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /sign out and clear this device/i }),
    ).toBeTruthy();
  });

  it("uses theme-aware surfaces, since the boundary mounts above the theme provider", () => {
    // .theme-light is written to <html> by the pre-paint script and survives an
    // App crash, so a fallback hardcoding bg-surface-950 / text-white renders
    // white-on-white in Sunlight Mode.
    const source = require("node:fs").readFileSync(
      require("node:path").resolve(process.cwd(), "components/ErrorBoundary.tsx"),
      "utf8",
    );
    expect(source).toContain("bg-surface-base text-content-primary");
    expect(source).not.toContain("bg-surface-950");
    // text-white is only wrong on a fill that inverts. The primary action sits
    // on bg-primary-600 (#1e40af, fixed in both themes, 9.6:1 with white), so
    // that one stays. Flag it anywhere else.
    const whiteOnInvertingFill =
      /className="(?![^"]*bg-primary-600)[^"]*\btext-white\b/;
    expect(source).not.toMatch(whiteOnInvertingFill);
  });
});
