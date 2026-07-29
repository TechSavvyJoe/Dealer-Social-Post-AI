import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhotoReleaseModal } from "../components/PhotoReleaseModal";

vi.mock("../components/SignaturePad", async () => {
  const ReactModule = await import("react");
  return {
    SignaturePad: ReactModule.forwardRef<
      { clear: () => void; isEmpty: () => boolean; toDataURL: () => string },
      { onChange?: (isEmpty: boolean) => void }
    >(({ onChange }, ref) => {
      ReactModule.useImperativeHandle(
        ref,
        () => ({
          clear: vi.fn(),
          isEmpty: () => false,
          toDataURL: () => "data:image/png;base64,c2lnbmF0dXJl",
        }),
        [],
      );
      ReactModule.useEffect(() => {
        onChange?.(false);
      }, [onChange]);
      return <div aria-label="Customer signature captured" />;
    }),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("photo release consent boundary", () => {
  it("returns to the post without implying that required consent can be skipped", () => {
    const onClose = vi.fn();
    const onCaptured = vi.fn();

    render(
      <PhotoReleaseModal
        isOpen
        dealershipName="Northside Motors"
        defaultCustomerName="Jamie Lee"
        onClose={onClose}
        onCaptured={onCaptured}
      />,
    );

    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    const backButton = screen.getByRole("button", { name: "Back to post" });
    expect(backButton).toHaveAccessibleDescription(
      "No release will be saved. Customer-photo AI generation stays blocked until a signed release is captured.",
    );

    fireEvent.click(backButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it("loads the latest customer name on reopen without clobbering active edits", () => {
    const { rerender } = render(
      <PhotoReleaseModal
        isOpen={false}
        dealershipName="Northside Motors"
        defaultCustomerName="First Customer"
        onClose={vi.fn()}
      />,
    );

    rerender(
      <PhotoReleaseModal
        isOpen={false}
        dealershipName="Northside Motors"
        defaultCustomerName="Latest Customer"
        onClose={vi.fn()}
      />,
    );
    rerender(
      <PhotoReleaseModal
        isOpen
        dealershipName="Northside Motors"
        defaultCustomerName="Latest Customer"
        onClose={vi.fn()}
      />,
    );

    const nameInput = screen.getByLabelText("Customer's full name");
    expect(nameInput).toHaveValue("Latest Customer");

    fireEvent.change(nameInput, { target: { value: "Customer's preferred name" } });
    rerender(
      <PhotoReleaseModal
        isOpen
        dealershipName="Northside Motors"
        defaultCustomerName="Upstream update"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Customer's full name")).toHaveValue(
      "Customer's preferred name",
    );
  });

  it("cancels the delayed auto-close after a manual close", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    render(
      <PhotoReleaseModal
        isOpen
        dealershipName="Northside Motors"
        defaultCustomerName="Jamie Lee"
        onClose={onClose}
        onCaptured={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Capture release" }));
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1_200);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels the delayed auto-close when the modal unmounts", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { unmount } = render(
      <PhotoReleaseModal
        isOpen
        dealershipName="Northside Motors"
        defaultCustomerName="Jamie Lee"
        onClose={onClose}
        onCaptured={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Capture release" }));
    unmount();
    act(() => {
      vi.advanceTimersByTime(1_200);
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
