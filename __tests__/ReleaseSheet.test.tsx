import React, { useEffect, useImperativeHandle } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReleaseSheet } from "../components/details/ReleaseSheet";

vi.mock("../components/SignaturePad", async () => {
  const ReactModule = await import("react");
  return {
    SignaturePad: ReactModule.forwardRef(
      ({ onChange }: { onChange?: (empty: boolean) => void }, ref) => {
        useImperativeHandle(ref, () => ({
          clear: vi.fn(),
          isEmpty: () => false,
          toDataURL: () => "data:image/png;base64,signed",
        }));
        useEffect(() => onChange?.(false), [onChange]);
        return <div aria-label="Signature pad" />;
      },
    ),
  };
});

describe("ReleaseSheet", () => {
  it("preserves the legal consent scope and captures the exact VIN-bound payload", async () => {
    const user = userEvent.setup();
    const onCaptured = vi.fn();
    render(
      <ReleaseSheet
        dealershipName="Bob Maxey Ford"
        vin="1FTFW1E50NFA12345"
        onCaptured={onCaptured}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/advertising, and other marketing materials/),
    ).toBeInTheDocument();
    expect(screen.getByText(/withdraw consent in writing/)).toBeInTheDocument();
    expect(screen.getByText("Attached VIN: 1FTFW1E50NFA12345")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Customer's full name"), "Maria Lopez");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onCaptured).toHaveBeenCalledWith({
      customerName: "Maria Lopez",
      signaturePngDataUrl: "data:image/png;base64,signed",
      vin: "1FTFW1E50NFA12345",
      linked: false,
    });
  });
});
