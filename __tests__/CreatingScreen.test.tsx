import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreatingScreen } from "../components/CreatingScreen";
import type { GenerationPartsReady, GenerationStage } from "../hooks/useGeneration";

const renderAt = (
  stage: GenerationStage,
  partsReady: GenerationPartsReady = { image: false, caption: false },
  onCancel = vi.fn(),
) => {
  render(
    <CreatingScreen
      imageSrc="data:image/jpeg;base64,cGhvdG8="
      stage={stage}
      partsReady={partsReady}
      onCancel={onCancel}
    />,
  );
  return onCancel;
};

const currentStep = () =>
  within(screen.getByRole("list", { name: "Post generation stages" }))
    .getAllByRole("listitem")
    .filter((item) => item.getAttribute("aria-current") === "step")
    .map((item) => item.textContent);

describe("CreatingScreen", () => {
  it.each([
    [
      "signature",
      { image: false, caption: false },
      "Design",
      "Saving the customer’s signature…",
    ],
    [
      "design",
      { image: false, caption: false },
      "Design",
      "Designing from your photo…",
    ],
    ["design", { image: true, caption: false }, "Caption", "Writing your caption…"],
    [
      "checks",
      { image: true, caption: true },
      "Final check",
      "Running a final check on the caption and image…",
    ],
    ["saving", { image: true, caption: true }, "Final check", "Saving to My work…"],
  ] as const)(
    "at stage %s with %o marks %s and says what is happening",
    (stage, partsReady, step, detail) => {
      renderAt(stage, partsReady);
      expect(currentStep()).toEqual([step]);
      expect(screen.getByRole("status")).toHaveTextContent("Creating your post…");
      expect(screen.getByRole("status")).toHaveTextContent(detail);
    },
  );

  it("names the three steps in the salesperson's words", () => {
    renderAt("design");
    expect(
      within(screen.getByRole("list", { name: "Post generation stages" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Design", "Caption", "Final check"]);
  });

  it("shows the source photo at full strength and its own aspect", () => {
    renderAt("design");
    const photo = screen.getByRole("img", { name: "Your source photo" });
    expect(photo.className).not.toMatch(/opacity-|aspect-/);
    expect(photo).toHaveClass("object-contain", "w-auto");
  });

  it("Cancel calls onCancel and says what it keeps", () => {
    const onCancel = renderAt("design");
    expect(
      screen.getByText("Cancel keeps your photo and details."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
