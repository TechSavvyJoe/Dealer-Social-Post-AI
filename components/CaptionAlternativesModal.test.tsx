import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";
import { CaptionAlternativesModal } from "./CaptionAlternativesModal";

describe("CaptionAlternativesModal", () => {
  it("uses each generateOne() result as-is, with no second compliance pass", async () => {
    // generateOne already returns a FULLY prepared caption (brand kit +
    // delivery-language gating + disclosures applied) — the modal must not
    // re-derive anything from it. A caption that looks "thin" on its own
    // (no store name, no hashtags) proves this: if the modal re-ran
    // prepareCaptionForDelivery with no brandKit/deliveryLanguageAllowed
    // context of its own, it would pad or alter the text.
    const generateOne = vi
      .fn()
      .mockResolvedValueOnce({
        caption: "Sarah's recall was completed today. Thanks for trusting our team!",
        disclosures: "",
        disclosureCategories: [],
      })
      .mockResolvedValueOnce({
        caption: "A second fully-prepared alternative caption.",
        disclosures: "Financing subject to credit approval.",
        disclosureCategories: ["financing_apr"],
      })
      .mockResolvedValueOnce({
        caption: "A third fully-prepared alternative caption.",
        disclosures: "",
        disclosureCategories: [],
      });

    render(
      <CaptionAlternativesModal
        isOpen
        onClose={vi.fn()}
        generateOne={generateOne}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(generateOne).toHaveBeenCalledTimes(3));
    expect(
      await screen.findByText(
        "Sarah's recall was completed today. Thanks for trusting our team!",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A second fully-prepared alternative caption."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A third fully-prepared alternative caption."),
    ).toBeInTheDocument();
  });

  it("carries the picked variant's disclosures through to onSelect unchanged", async () => {
    const generateOne = vi.fn().mockResolvedValue({
      caption: "Drive home today with 4.9% APR on approved credit.",
      disclosures: "Financing subject to credit approval.",
      disclosureCategories: ["financing_apr"],
    });
    const onSelect = vi.fn();

    render(
      <CaptionAlternativesModal
        isOpen
        onClose={vi.fn()}
        generateOne={generateOne}
        onSelect={onSelect}
        count={1}
      />,
    );

    const card = await screen.findByText(
      "Drive home today with 4.9% APR on approved credit.",
    );
    card.closest("button")?.click();

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        text: "Drive home today with 4.9% APR on approved credit.",
        disclosures: "Financing subject to credit approval.",
        disclosureCategories: ["financing_apr"],
      }),
    );
  });
});
