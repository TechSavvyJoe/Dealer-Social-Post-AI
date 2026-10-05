import React, { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignaturePad, type SignaturePadHandle } from "../components/SignaturePad";
import { TYPED_SIGNATURE_ATTESTATION } from "../components/details/releaseConsent";

/** Frozen copy of the approved attestation. Change only with legal sign-off. */
const APPROVED_ATTESTATION =
  "I am the named customer and agree that typing my name is my electronic signature for this photo release.";

/** Sunlight Mode's ink token, exactly as globals.css writes it. */
const SUNLIGHT_INK = "20 22 24";

const makeContext = () => ({
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  fillText: vi.fn(),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  setTransform: vi.fn(),
  stroke: vi.fn(),
  fillStyle: "",
  font: "",
  lineCap: "butt",
  lineJoin: "miter",
  lineWidth: 1,
  strokeStyle: "",
  textAlign: "start",
  textBaseline: "alphabetic",
});

let context: ReturnType<typeof makeContext>;

beforeEach(() => {
  context = makeContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,drawn",
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  document.documentElement.style.setProperty("--ink", SUNLIGHT_INK);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty("--ink");
});

const draw = (canvas: HTMLElement) => {
  fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
  fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
};

describe("SignaturePad", () => {
  it("draws in the theme's ink so the signature shows on the Sunlight pad", () => {
    render(<SignaturePad />);
    // A fixed white stroke (the old default) is invisible on the near-white pad.
    expect(context.strokeStyle).toBe("rgb(20, 22, 24)");
  });

  it("lets the caller's stroke colour win over the theme ink", () => {
    render(<SignaturePad strokeColor="rgb(1, 2, 3)" />);
    expect(context.strokeStyle).toBe("rgb(1, 2, 3)");
  });

  it("writes the typed signature image in the same ink", async () => {
    const user = userEvent.setup();
    const ref = createRef<SignaturePadHandle>();
    render(<SignaturePad ref={ref} />);

    await user.click(screen.getByRole("button", { name: "Type name instead" }));
    await user.type(
      screen.getByLabelText("Type the customer’s full legal name"),
      "Maria Lopez",
    );
    await user.click(screen.getByRole("checkbox"));
    expect(ref.current?.toDataURL()).toBe("data:image/png;base64,drawn");
    expect(context.fillStyle).toBe("rgb(20, 22, 24)");
    expect(context.fillText).toHaveBeenCalledWith(
      "Maria Lopez",
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("names the group and reports the drawn state in plain words", () => {
    render(<SignaturePad />);
    expect(
      screen.getByRole("group", { name: "Customer's signature" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Not signed yet");
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();

    draw(screen.getByRole("img", { name: /draw the customer's signature/i }));
    expect(screen.getByRole("status")).toHaveTextContent("Signed");
    expect(screen.getByRole("button", { name: "Clear" })).toBeEnabled();
  });

  it("switches modes with one text toggle and keeps a drawn signature across the switch", async () => {
    const user = userEvent.setup();
    const ref = createRef<SignaturePadHandle>();
    const onChange = vi.fn();
    render(<SignaturePad ref={ref} onChange={onChange} />);
    expect(
      screen.queryByRole("button", { name: /draw signature/i }),
    ).not.toBeInTheDocument();

    const canvas = screen.getByRole("img", { name: /draw the customer's signature/i });
    draw(canvas);
    expect(onChange).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByRole("button", { name: "Type name instead" }));
    expect(
      screen.queryByRole("img", { name: /draw the customer's signature/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Type the customer’s full legal name")).toBeVisible();
    // Typed mode is empty until the name and the attestation are both given.
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(ref.current?.toDataURL()).toBeNull();

    await user.click(screen.getByRole("button", { name: "Draw instead" }));
    // The same canvas comes back with its strokes; a remount would hand back a
    // blank canvas still counted as signed.
    expect(screen.getByRole("img", { name: /draw the customer's signature/i })).toBe(
      canvas,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Signed");
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(ref.current?.toDataURL()).toBe("data:image/png;base64,drawn");
  });

  it("keeps the typed attestation word for word and completes only when it is ticked", async () => {
    const user = userEvent.setup();
    const ref = createRef<SignaturePadHandle>();
    render(<SignaturePad ref={ref} />);
    await user.click(screen.getByRole("button", { name: "Type name instead" }));

    expect(TYPED_SIGNATURE_ATTESTATION).toBe(APPROVED_ATTESTATION);
    const attestation = screen.getByRole("checkbox", { name: APPROVED_ATTESTATION });
    await user.type(
      screen.getByLabelText("Type the customer’s full legal name"),
      "Maria Lopez",
    );
    expect(ref.current?.isEmpty()).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Enter the customer’s name and confirm the attestation.",
    );
    await user.click(attestation);
    expect(ref.current?.isEmpty()).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent("Electronic signature ready");
  });

  it("never offers AutoFill for the typed legal name", async () => {
    const user = userEvent.setup();
    render(<SignaturePad />);
    await user.click(screen.getByRole("button", { name: "Type name instead" }));
    const field = screen.getByLabelText("Type the customer’s full legal name");
    expect(field).toHaveAttribute("autocomplete", "off");
    // Safari's contact AutoFill keys on "name" anywhere in the field name.
    expect(field.getAttribute("name") ?? "").not.toMatch(/name/i);
  });

  it("reports the one step still missing in the visible mode", async () => {
    const user = userEvent.setup();
    const ref = createRef<SignaturePadHandle>();
    render(<SignaturePad ref={ref} />);
    expect(ref.current?.missingStep()).toBe("drawing");
    draw(screen.getByRole("img", { name: /draw the customer's signature/i }));
    expect(ref.current?.missingStep()).toBeNull();

    await user.click(screen.getByRole("button", { name: "Type name instead" }));
    expect(ref.current?.missingStep()).toBe("typed_name");
    await user.type(
      screen.getByLabelText("Type the customer’s full legal name"),
      "Maria Lopez",
    );
    expect(ref.current?.missingStep()).toBe("attestation");
    await user.click(screen.getByRole("checkbox"));
    expect(ref.current?.missingStep()).toBeNull();
  });

  it("lets the caller describe the signature group with its error", () => {
    render(
      <>
        <SignaturePad describedBy="sheet-signature-error" />
        <p id="sheet-signature-error">Have the customer sign in the box above.</p>
      </>,
    );
    expect(screen.getByRole("group", { name: "Customer's signature" })).toHaveAttribute(
      "aria-describedby",
      "sheet-signature-error",
    );
  });
});
