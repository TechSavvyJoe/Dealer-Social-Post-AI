import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VinScanner } from "./VinScanner";
const mocks = vi.hoisted(() => ({ decode: vi.fn(), photo: vi.fn() }));
vi.mock("../services/vinDecoder", async (original) => ({
  ...(await original<typeof import("../services/vinDecoder")>()),
  decodeVin: mocks.decode,
}));
vi.mock("../services/vinPhotoReader", () => ({ readVinPhoto: mocks.photo }));
vi.mock("../utils/haptics", () => ({ triggerHapticFeedback: vi.fn() }));
const VIN = "1HGCM82633A004352";
const vehicle = {
  vin: VIN,
  year: "2003",
  make: "HONDA",
  model: "Accord",
  summary: "2003 Honda Accord",
  empty: false,
};
const photo = () => new File(["synthetic"], "label.jpg", { type: "image/jpeg" });
const tick = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
beforeEach(() => {
  mocks.decode.mockReset().mockResolvedValue(vehicle);
  mocks.photo.mockReset().mockResolvedValue(VIN);
  Object.defineProperty(window, "BarcodeDetector", {
    configurable: true,
    value: undefined,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const enterManual = () => {
  fireEvent.click(screen.getByRole("button", { name: "Type VIN" }));
  fireEvent.change(screen.getByLabelText("VIN (17 characters)"), {
    target: { value: VIN },
  });
  fireEvent.click(screen.getByRole("button", { name: "Decode VIN" }));
};
describe("shared VIN scanner", () => {
  it.each(["Take VIN photo", "Choose VIN photo"])(
    "opens with photo capture, reads %s only on selection, and requires VIN plus vehicle review",
    async (label) => {
      const apply = vi.fn();
      const close = vi.fn();
      render(<VinScanner isOpen onClose={close} onVehicleDecoded={apply} />);
      expect(screen.getByRole("button", { name: "VIN photo" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(mocks.photo).not.toHaveBeenCalled();
      expect(mocks.decode).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Take VIN photo")).toHaveAttribute(
        "capture",
        "environment",
      );
      expect(screen.getByLabelText("Choose VIN photo")).not.toHaveAttribute("capture");
      fireEvent.change(screen.getByLabelText(label), { target: { files: [photo()] } });
      await tick();
      expect(screen.getByLabelText("VIN (17 characters)")).toHaveValue(VIN);
      expect(mocks.decode).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Decode VIN" }));
      await tick();
      expect(screen.getByText("2003 Honda Accord")).toBeVisible();
      expect(apply).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Use this vehicle" }));
      expect(apply).toHaveBeenCalledWith(vehicle);
      expect(close).toHaveBeenCalledOnce();
    },
  );
  it("routes an explicit scanner request to photo entry when live barcode is unavailable", () => {
    render(
      <VinScanner
        isOpen
        initialMode="scanner"
        onClose={vi.fn()}
        onVehicleDecoded={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "VIN photo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByLabelText("Live camera view for VIN barcode scanning"),
    ).not.toBeInTheDocument();
    expect(mocks.photo).not.toHaveBeenCalled();
  });
  it("manual lookup never fills automatically and editing clears the previous vehicle", async () => {
    const apply = vi.fn();
    render(
      <VinScanner
        isOpen
        initialMode="manual"
        onClose={vi.fn()}
        onVehicleDecoded={apply}
      />,
    );
    enterManual();
    await tick();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("VIN (17 characters)"), {
      target: { value: VIN.slice(0, 16) },
    });
    expect(
      screen.queryByRole("button", { name: "Use this vehicle" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decode VIN" })).toBeDisabled();
  });
  it.each(["photo", "lookup"])(
    "aborts %s on close/reopen and ignores its late completion",
    async (kind) => {
      let finish!: (result: unknown) => void;
      const mock = kind === "photo" ? mocks.photo : mocks.decode;
      mock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const apply = vi.fn();
      const close = vi.fn();
      const view = render(
        <VinScanner isOpen onClose={close} onVehicleDecoded={apply} />,
      );
      if (kind === "photo")
        fireEvent.change(screen.getByLabelText("Choose VIN photo"), {
          target: { files: [photo()] },
        });
      else enterManual();
      const signal = mock.mock.calls[0][1] as AbortSignal;
      view.rerender(
        <VinScanner isOpen={false} onClose={close} onVehicleDecoded={apply} />,
      );
      expect(signal.aborted).toBe(true);
      view.rerender(<VinScanner isOpen onClose={close} onVehicleDecoded={apply} />);
      await act(async () => {
        finish(kind === "photo" ? VIN : vehicle);
      });
      expect(screen.getByRole("button", { name: "VIN photo" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(
        screen.queryByRole("button", { name: "Use this vehicle" }),
      ).not.toBeInTheDocument();
      expect(apply).not.toHaveBeenCalled();
    },
  );
  it("new photo and mode changes invalidate older OCR responses", async () => {
    let finishOld!: (value: string) => void;
    mocks.photo.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    render(<VinScanner isOpen onClose={vi.fn()} onVehicleDecoded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Choose VIN photo"), {
      target: { files: [photo()] },
    });
    const oldSignal = mocks.photo.mock.calls[0][1] as AbortSignal;
    fireEvent.change(screen.getByLabelText("Take VIN photo"), {
      target: { files: [photo()] },
    });
    await tick();
    expect(oldSignal.aborted).toBe(true);
    await act(async () => {
      finishOld("1HGCM82633A004353");
    });
    expect(screen.getByLabelText("VIN (17 characters)")).toHaveValue(VIN);
    fireEvent.click(screen.getByRole("button", { name: "Decode VIN" }));
    const signal = mocks.decode.mock.calls[0][1] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "VIN photo" }));
    await tick();
    expect(signal.aborted).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Use this vehicle" }),
    ).not.toBeInTheDocument();
  });
  it("confirms a reviewed vehicle only once even before the parent closes", async () => {
    const apply = vi.fn();
    render(<VinScanner isOpen onClose={vi.fn()} onVehicleDecoded={apply} />);
    enterManual();
    await tick();
    const confirm = screen.getByRole("button", { name: "Use this vehicle" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(apply).toHaveBeenCalledOnce();
  });
  it("starting a new photo picker immediately aborts and discards an older OCR response", async () => {
    let finish!: (result: string) => void;
    mocks.photo.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<VinScanner isOpen onClose={vi.fn()} onVehicleDecoded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Choose VIN photo"), {
      target: { files: [photo()] },
    });
    const signal = mocks.photo.mock.calls[0][1] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Take VIN photo" }));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish(VIN);
    });
    expect(screen.queryByLabelText("VIN (17 characters)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "VIN photo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("unmount aborts image reading", () => {
    mocks.photo.mockImplementationOnce(() => new Promise(() => {}));
    const view = render(
      <VinScanner isOpen onClose={vi.fn()} onVehicleDecoded={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Choose VIN photo"), {
      target: { files: [photo()] },
    });
    const signal = mocks.photo.mock.calls[0][1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
  it("shows retake guidance for OCR failure and rejects empty/mismatched lookup results", async () => {
    mocks.photo.mockRejectedValueOnce(new Error("Retake a sharp VIN photo."));
    render(<VinScanner isOpen onClose={vi.fn()} onVehicleDecoded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Choose VIN photo"), {
      target: { files: [photo()] },
    });
    await tick();
    expect(screen.getByRole("alert")).toHaveTextContent(/Retake/i);
    mocks.decode.mockResolvedValueOnce({ ...vehicle, vin: "1HGCM82633A004353" });
    enterManual();
    await tick();
    expect(screen.getByRole("alert")).toHaveTextContent(/does not match/i);
    expect(
      screen.queryByRole("button", { name: "Use this vehicle" }),
    ).not.toBeInTheDocument();
  });
  it("live barcode lookup also requires confirmation", async () => {
    const stop = vi.fn();
    const detect = vi.fn().mockResolvedValue([{ rawValue: VIN }]);
    Object.defineProperty(window, "BarcodeDetector", {
      configurable: true,
      value: class {
        detect = detect;
        static getSupportedFormats = async () => ["code_39"];
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const apply = vi.fn();
    render(<VinScanner isOpen onClose={vi.fn()} onVehicleDecoded={apply} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Use this vehicle" })).toBeVisible(),
    );
    expect(stop).toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use this vehicle" }));
    expect(apply).toHaveBeenCalledWith(vehicle);
  });
});
