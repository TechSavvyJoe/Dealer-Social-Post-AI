import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import {
  ImageCropModal,
  constrainImageDimensions,
} from "../components/ImageCropModal";
import { LoginScreen } from "../components/LoginScreen";
import { Input, Textarea } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { ToastProvider } from "../components/ui/Toast";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

Object.assign(global.navigator, { vibrate: vi.fn() });

describe("frontend production pass", () => {
  it("keeps controlled field labels floated and associates supporting text", () => {
    const ControlledFields = () => {
      const [name, setName] = useState("Alex");
      const [caption, setCaption] = useState("Ready for delivery");
      return (
        <>
          <Input
            label="Salesperson"
            value={name}
            onChange={(event) => setName(event.target.value)}
            helperText="Shown on the post"
          />
          <Textarea
            label="Caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            error="Caption needs review"
          />
        </>
      );
    };

    render(<ControlledFields />);

    const input = screen.getByLabelText("Salesperson");
    const textarea = screen.getByLabelText("Caption");
    fireEvent.blur(input);
    fireEvent.blur(textarea);

    expect(screen.getByText("Salesperson")).toHaveClass("top-1.5");
    expect(screen.getByText("Caption")).toHaveClass("top-1.5");
    expect(input).toHaveAccessibleDescription("Shown on the post");
    expect(textarea).toHaveAccessibleDescription("Caption needs review");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
  });

  it("generates unique IDs even when fields have no labels", () => {
    render(
      <>
        <Input aria-label="First field" />
        <Input aria-label="Second field" />
      </>,
    );

    const firstId = screen.getByLabelText("First field").id;
    const secondId = screen.getByLabelText("Second field").id;
    expect(firstId).not.toContain("undefined");
    expect(secondId).not.toContain("undefined");
    expect(firstId).not.toBe(secondId);
  });

  it("closes dialogs with Escape and restores focus to the trigger", async () => {
    const Harness = () => {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>
            Open settings
          </button>
          <Modal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            title="Studio settings"
            description="Adjust the workspace."
          >
            <button type="button">Save changes</button>
          </Modal>
        </>
      );
    };

    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open settings" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Studio settings" });
    expect(dialog).toHaveAccessibleDescription("Adjust the workspace.");
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("lets an open dialog consume Escape without triggering global cancel", async () => {
    const globalCancel = vi.fn();
    const Harness = () => {
      const [isOpen, setIsOpen] = useState(true);
      useKeyboardShortcuts({ onCancel: globalCancel });
      return (
        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Edit creative"
        >
          <button type="button">Apply</button>
        </Modal>
      );
    };

    render(<Harness />);
    const dialog = screen.getByRole("dialog", { name: "Edit creative" });
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(globalCancel).not.toHaveBeenCalled();
  });

  it("offers touch-accessible system admin entry", async () => {
    const onLogin = vi.fn().mockResolvedValue(false);
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <LoginScreen onLogin={onLogin} />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "System admin" }));
    const adminInput = await screen.findByLabelText("System admin code");
    await user.type(adminInput, "admin99");
    expect(adminInput).toHaveValue("ADMIN99");

    await user.click(
      screen.getByRole("button", { name: /Continue to system admin/i }),
    );
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith("ADMIN99"));
  });

  it("caps reviewed photo dimensions while preserving aspect ratio", () => {
    expect(constrainImageDimensions(6000, 4000)).toEqual({
      width: 2048,
      height: 1365,
    });
    expect(constrainImageDimensions(1200, 800)).toEqual({
      width: 1200,
      height: 800,
    });
  });

  it("exposes the photo review as a described modal dialog", () => {
    render(
      <ImageCropModal
        isOpen
        imageSrc="data:image/png;base64,preview"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Review photo" });
    expect(dialog).toHaveAccessibleDescription(
      "Check the framing before creating the post. The original aspect ratio is preserved.",
    );
    const usePhotoButton = screen.getByRole("button", { name: "Use photo" });
    expect(usePhotoButton).toBeDisabled();

    fireEvent.load(screen.getByAltText("Selected vehicle photo preview"));
    expect(usePhotoButton).toBeEnabled();
  });
});
