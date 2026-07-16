import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { ImageInput } from "../components/CameraCapture";
import * as imageUtils from "../utils/imageUtils";
import { vi } from "vitest";

// Mock the imageUtils module
vi.mock("../utils/imageUtils", () => ({
  fileToNormalizedDataUrl: vi.fn(),
}));

describe("ImageInput Drag and Drop", () => {
  const mockOnImageSelected = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock fileToNormalizedDataUrl to return a dummy data URL
    (imageUtils.fileToNormalizedDataUrl as any).mockResolvedValue(
      "data:image/png;base64,dummydata",
    );
  });

  it("should send a dropped photo to the single global review flow", async () => {
    render(
      <ImageInput
        onImageSelected={mockOnImageSelected}
        onClose={mockOnClose}
      />,
    );

    const dropZone = screen
      .getByText("Add a photo")
      .closest("div")?.parentElement;
    expect(dropZone).toBeInTheDocument();

    const file = new File(["dummy content"], "test.png", { type: "image/png" });

    // Simulate drag enter on window
    fireEvent.dragEnter(window, {
      dataTransfer: {
        items: [{ kind: "file", type: "image/png" }],
      },
    });

    // Expect visual feedback
    expect(screen.getByText("Drop image here")).toBeInTheDocument();

    // Simulate drop on window
    await act(async () => {
      const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, "dataTransfer", {
        value: {
          files: [file],
        },
      });
      window.dispatchEvent(dropEvent);
    });

    // Expect file processing to be called
    expect(imageUtils.fileToNormalizedDataUrl).toHaveBeenCalledWith(file);

    // CameraCapture no longer opens its own review dialog. The app-level
    // ImageCropModal is the one authoritative review/crop surface.
    await waitFor(() => {
      expect(mockOnImageSelected).toHaveBeenCalledWith(
        "data:image/png;base64,dummydata",
      );
    });
    expect(screen.queryByAltText("Captured preview")).not.toBeInTheDocument();
  });

  it("should handle invalid file type drop", async () => {
    render(
      <ImageInput
        onImageSelected={mockOnImageSelected}
        onClose={mockOnClose}
      />,
    );

    const file = new File(["dummy content"], "test.txt", {
      type: "text/plain",
    });

    await act(async () => {
      const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, "dataTransfer", {
        value: {
          files: [file],
        },
      });
      window.dispatchEvent(dropEvent);
    });

    // Expect error message
    await waitFor(() => {
      expect(
        screen.getByText("Invalid file type. Please use an image file."),
      ).toBeInTheDocument();
    });

    expect(imageUtils.fileToNormalizedDataUrl).not.toHaveBeenCalled();
  });
});
