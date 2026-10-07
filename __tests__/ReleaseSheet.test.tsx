import React, { useEffect, useImperativeHandle } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReleaseSheet } from "../components/details/ReleaseSheet";
import {
  releaseConsentText,
  RELEASE_STORAGE_NOTICE,
} from "../components/details/releaseConsent";
import { logEvent } from "../utils/telemetry";

/*
 * Frozen copies of the approved, legally operative wording (production
 * PhotoReleaseModal on origin/main). They are deliberately NOT imported from
 * releaseConsent.ts: an edit there must fail this file until it is signed off.
 */
const APPROVED_CONSENT =
  "By signing below, the customer grants Bob Maxey Ford permission to use the photo taken today on social media, websites, advertising, and other marketing materials. The customer may withdraw consent in writing at any time by contacting the dealership.";
const APPROVED_STORAGE_NOTICE =
  "Required for customer-focused posts. It is stored securely before AI processing, linked only to this post, and an abandoned unlinked capture expires within 24 hours.";

const pad = vi.hoisted(() => ({
  dataUrl: "data:image/png;base64,signed" as string | null,
  gap: "drawing" as "drawing" | "typed_name" | "attestation",
  strokeColors: [] as Array<string | undefined>,
}));

vi.mock("../utils/telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/telemetry")>()),
  logEvent: vi.fn(),
}));

vi.mock("../components/SignaturePad", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/SignaturePad")>();
  const ReactModule = await import("react");
  return {
    readInkColor: actual.readInkColor,
    SignaturePad: ReactModule.forwardRef(
      (
        {
          onChange,
          strokeColor,
          describedBy,
        }: {
          onChange?: (empty: boolean) => void;
          strokeColor?: string;
          describedBy?: string;
        },
        ref,
      ) => {
        pad.strokeColors.push(strokeColor);
        useImperativeHandle(ref, () => ({
          clear: vi.fn(),
          isEmpty: () => !pad.dataUrl,
          toDataURL: () => pad.dataUrl,
          missingStep: () => (pad.dataUrl ? null : pad.gap),
        }));
        useEffect(() => onChange?.(!pad.dataUrl), [onChange]);
        return (
          <div role="group" aria-label="Signature pad" aria-describedby={describedBy} />
        );
      },
    ),
  };
});

const normalise = (text: string | null | undefined) =>
  (text ?? "").replace(/\s+/g, " ").trim();

const paragraphStartingWith = (prefix: string) =>
  screen.getByText(
    (_, element) =>
      element?.tagName === "P" && normalise(element.textContent).startsWith(prefix),
  );

const renderSheet = (props: Partial<React.ComponentProps<typeof ReleaseSheet>> = {}) =>
  render(
    <ReleaseSheet
      dealershipName="Bob Maxey Ford"
      vin="1FTFW1E50NFA12345"
      onCaptured={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
  );

beforeEach(() => {
  pad.dataUrl = "data:image/png;base64,signed";
  pad.gap = "drawing";
  pad.strokeColors = [];
});

afterEach(() => {
  vi.mocked(logEvent).mockClear();
  document.documentElement.style.removeProperty("--ink");
});

describe("ReleaseSheet", () => {
  it("shows the approved consent and storage wording word for word, before the save button", () => {
    renderSheet();

    expect(releaseConsentText("Bob Maxey Ford")).toBe(APPROVED_CONSENT);
    expect(RELEASE_STORAGE_NOTICE).toBe(APPROVED_STORAGE_NOTICE);

    const consent = paragraphStartingWith("By signing below");
    const storage = paragraphStartingWith("Required for customer-focused posts");
    const vinRow = screen.getByText("Attached VIN: 1FTFW1E50NFA12345");
    expect(normalise(consent.textContent)).toBe(APPROVED_CONSENT);
    expect(normalise(storage.textContent)).toBe(APPROVED_STORAGE_NOTICE);
    expect(screen.getByText("Bob Maxey Ford").tagName).toBe("STRONG");

    const save = screen.getByRole("button", { name: "Save signature" });
    for (const node of [consent, vinRow, storage]) {
      expect(
        node.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("captures the exact VIN-bound payload and logs the capture", async () => {
    const user = userEvent.setup();
    const onCaptured = vi.fn();
    renderSheet({ onCaptured });

    await user.type(screen.getByLabelText("Customer's full name"), "Maria Lopez");
    await user.click(screen.getByRole("button", { name: "Save signature" }));
    expect(onCaptured).toHaveBeenCalledTimes(1);
    expect(onCaptured).toHaveBeenCalledWith({
      customerName: "Maria Lopez",
      signaturePngDataUrl: "data:image/png;base64,signed",
      vin: "1FTFW1E50NFA12345",
      linked: false,
    });
    expect(logEvent).toHaveBeenCalledWith("photo_release.captured", {
      vinPresent: true,
    });
  });

  it("keeps Save signature enabled and says what is missing", async () => {
    const user = userEvent.setup();
    const onCaptured = vi.fn();
    pad.dataUrl = null;
    renderSheet({ onCaptured });

    const save = screen.getByRole("button", { name: "Save signature" });
    expect(save).toBeEnabled();
    await user.click(save);
    const name = screen.getByLabelText("Customer's full name");
    expect(screen.getByText("Enter the customer's full name.")).toBeInTheDocument();
    expect(
      screen.getByText("Have the customer sign in the box above."),
    ).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveFocus();

    await user.type(name, "Maria Lopez");
    expect(
      screen.queryByText("Enter the customer's full name."),
    ).not.toBeInTheDocument();
    await user.click(save);
    expect(
      screen.getByText("Have the customer sign in the box above."),
    ).toBeInTheDocument();
    expect(onCaptured).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("never offers AutoFill for the customer's legal name", () => {
    renderSheet({ defaultCustomerName: "Maria Lopez" });
    const name = screen.getByLabelText("Customer's full name");
    expect(name).toHaveValue("Maria Lopez");
    expect(name).toHaveAttribute("autocomplete", "off");
    // Safari's contact AutoFill keys on "name" anywhere in the field name.
    expect(name.getAttribute("name") ?? "").not.toMatch(/name/i);
    expect(name.id).not.toMatch(/name/i);
  });

  it("names the typed-signature step that is still missing and links it to the pad", async () => {
    const user = userEvent.setup();
    pad.dataUrl = null;
    pad.gap = "attestation";
    renderSheet({ defaultCustomerName: "Maria Lopez" });

    const save = screen.getByRole("button", { name: "Save signature" });
    await user.click(save);
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Have the customer tick the box above to confirm.");
    expect(
      screen.queryByText("Have the customer sign in the box above."),
    ).not.toBeInTheDocument();
    // The pad is described by the error, so it is read out on return to it.
    expect(error.id).not.toBe("");
    expect(screen.getByRole("group", { name: "Signature pad" })).toHaveAttribute(
      "aria-describedby",
      error.id,
    );

    pad.gap = "typed_name";
    await user.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Have the customer type their full legal name above.",
    );
  });

  it("draws in the theme's ink so the signature shows in Sunlight", () => {
    document.documentElement.style.setProperty("--ink", "20 22 24");
    renderSheet();
    expect(pad.strokeColors.at(-1)).toBe("rgb(20, 22, 24)");
  });

  it("cancels without capturing", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onCaptured = vi.fn();
    renderSheet({ onCancel, onCaptured });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCaptured).not.toHaveBeenCalled();
  });
});
