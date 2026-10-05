import React, { createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignaturePad, SignaturePadHandle } from "../components/SignaturePad";
import { PwaUpdatePrompt } from "../components/PwaUpdatePrompt";
import { ToastProvider, useToast } from "../components/ui/Toast";
import { VinScanner } from "../components/VinScanner";
import { PostHistory } from "../components/PostHistory";
import { CustomScenarioManager } from "../components/CustomScenarioManager";

const canvasContext = {
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
  lineCap: "round",
  lineJoin: "round",
  lineWidth: 1,
  strokeStyle: "",
  textAlign: "center",
  textBaseline: "middle",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("frontend accessibility repairs", () => {
  it("keeps the signature canvas responsive and offers a typed attestation", async () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      canvasContext as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,signed",
    );

    const signatureRef = createRef<SignaturePadHandle>();
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SignaturePad ref={signatureRef} onChange={onChange} />);

    const canvas = screen.getByRole("img", {
      name: /draw the customer's signature/i,
    }) as HTMLCanvasElement;
    act(() => {
      resizeCallback?.(
        [
          {
            contentRect: { width: 320 },
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    });
    expect(canvas.style.width).toBe("320px");
    expect(canvas.width).toBe(320);

    await user.click(screen.getByRole("button", { name: "Type name instead" }));
    await user.type(
      screen.getByLabelText("Type the customer’s full legal name"),
      "Jane Smith",
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /typing my name is my electronic signature/i,
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("Electronic signature ready");
    expect(signatureRef.current?.isEmpty()).toBe(false);
    expect(signatureRef.current?.toDataURL()).toBe("data:image/png;base64,signed");
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("offers keyboard-accessible service-worker update actions", async () => {
    class TestWorker extends EventTarget {
      state: ServiceWorkerState = "installing";
      postMessage = vi.fn();
    }
    class TestRegistration extends EventTarget {
      installing: ServiceWorker | null;
      waiting: ServiceWorker | null = null;

      constructor(worker: ServiceWorker) {
        super();
        this.installing = worker;
      }
    }

    const worker = new TestWorker();
    const registration = new TestRegistration(worker as unknown as ServiceWorker);
    const serviceWorker = Object.assign(new EventTarget(), {
      controller: {},
      register: vi.fn().mockResolvedValue(registration),
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });

    const user = userEvent.setup();
    const onReload = vi.fn();
    render(<PwaUpdatePrompt enabled onReload={onReload} />);
    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalledTimes(1));
    expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });

    act(() => {
      registration.dispatchEvent(new Event("updatefound"));
      worker.state = "installed";
      worker.dispatchEvent(new Event("statechange"));
    });

    const updateButton = await screen.findByRole("button", { name: "Update" });
    expect(screen.getByRole("region", { name: "A new version is ready" })).toHaveClass(
      "pwa-update-prompt",
    );
    expect(screen.getByRole("button", { name: "Update later" })).toBeVisible();
    await user.click(updateButton);

    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(updateButton).toHaveTextContent("Updating…");
    act(() => serviceWorker.dispatchEvent(new Event("controllerchange")));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("detects an already-waiting worker and recovers from a failed update", async () => {
    class WaitingWorker extends EventTarget {
      state: ServiceWorkerState = "installed";
      postMessage = vi.fn();
    }
    const worker = new WaitingWorker();
    const registration = Object.assign(new EventTarget(), {
      installing: null,
      waiting: worker as unknown as ServiceWorker,
    });
    const serviceWorker = Object.assign(new EventTarget(), {
      controller: {},
      register: vi.fn().mockResolvedValue(registration),
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });

    render(<PwaUpdatePrompt enabled updateTimeoutMs={5} onReload={vi.fn()} />);
    const updateButton = await screen.findByRole("button", { name: "Update" });
    fireEvent.click(updateButton);

    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(
      await screen.findByText(
        "Update could not finish. Check your connection and try again.",
      ),
    ).toHaveAttribute("role", "alert");
    expect(updateButton).toBeEnabled();
    expect(updateButton).toHaveTextContent("Update");

    fireEvent.click(screen.getByRole("button", { name: "Update later" }));
    expect(
      screen.queryByRole("region", { name: "A new version is ready" }),
    ).not.toBeInTheDocument();
  });

  it("re-checks for a new release when the installed app returns to the foreground", async () => {
    class WaitingWorker extends EventTarget {
      state: ServiceWorkerState = "installed";
      postMessage = vi.fn();
    }
    const registration = Object.assign(new EventTarget(), {
      installing: null,
      waiting: null as ServiceWorker | null,
      update: vi.fn().mockResolvedValue(undefined),
    });
    const serviceWorker = Object.assign(new EventTarget(), {
      controller: {},
      register: vi.fn().mockResolvedValue(registration),
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });

    // Registration alone must not raise a banner: nothing is waiting yet.
    render(
      <PwaUpdatePrompt enabled foregroundCheckIntervalMs={0} onReload={vi.fn()} />,
    );
    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("region", { name: "A new version is ready" }),
    ).not.toBeInTheDocument();

    // Backgrounded: a release ships and its worker installs, but no
    // `updatefound` reaches this document.
    visibility = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    registration.waiting = new WaitingWorker() as unknown as ServiceWorker;

    // Resumed from the app switcher — the banner must appear without a cold
    // relaunch, and a fresh check must be requested.
    visibility = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(await screen.findByRole("button", { name: "Update" })).toBeVisible();
    expect(registration.update).toHaveBeenCalled();
  });

  it("does not hammer the network with foreground update checks", async () => {
    const registration = Object.assign(new EventTarget(), {
      installing: null,
      waiting: null,
      update: vi.fn().mockResolvedValue(undefined),
    });
    const serviceWorker = Object.assign(new EventTarget(), {
      controller: {},
      register: vi.fn().mockResolvedValue(registration),
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    render(
      <PwaUpdatePrompt enabled foregroundCheckIntervalMs={60_000} onReload={vi.fn()} />,
    );
    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalledTimes(1));

    for (let i = 0; i < 5; i += 1) {
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      act(() => window.dispatchEvent(new Event("focus")));
    }
    // Registration itself just checked; the throttle must suppress the rest.
    expect(registration.update).not.toHaveBeenCalled();
  });

  it("deduplicates persistent errors and pauses timed toasts", () => {
    vi.useFakeTimers();
    const Harness = () => {
      const toast = useToast();
      return (
        <>
          <button type="button" onClick={() => toast.error("Could not save")}>
            Show error
          </button>
          <button type="button" onClick={() => toast.success("Saved")}>
            Show success
          </button>
        </>
      );
    };

    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show error" }));
    fireEvent.click(screen.getByRole("button", { name: "Show error" }));
    fireEvent.click(screen.getByRole("button", { name: "Show error" }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    const errorToast = screen.getByRole("alert");
    expect(errorToast).toHaveTextContent("Notification repeated 3 times.");
    act(() => vi.advanceTimersByTime(60_000));
    expect(errorToast).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Show success" }));
    const successToast = screen.getByRole("status");
    act(() => vi.advanceTimersByTime(1_000));
    fireEvent.mouseEnter(successToast);
    fireEvent.click(screen.getByRole("button", { name: "Show success" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Notification repeated 2 times.",
    );
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("status")).toBeVisible();
    fireEvent.mouseLeave(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(4_900));
    expect(screen.getByRole("status")).toBeVisible();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("serializes native VIN barcode detection", async () => {
    vi.useFakeTimers();
    let resolveFirstDetection:
      ((results: Array<{ rawValue: string }>) => void) | undefined;
    const detect = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Array<{ rawValue: string }>>((resolve) => {
            resolveFirstDetection = resolve;
          }),
      )
      .mockResolvedValue([]);
    class TestBarcodeDetector {
      static getSupportedFormats = vi.fn().mockResolvedValue(["code_39", "code_128"]);
      detect = detect;
    }
    Object.defineProperty(window, "BarcodeDetector", {
      configurable: true,
      value: TestBarcodeDetector,
    });
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        }),
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    const { unmount } = render(
      <VinScanner isOpen onClose={vi.fn()} onVehicleDecoded={vi.fn()} />,
    );
    await act(async () => {
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }
    });
    act(() => vi.advanceTimersByTime(0));
    expect(detect).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(5_000));
    expect(detect).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstDetection?.([]);
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(400));
    expect(detect).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("group", { name: "VIN entry method" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Point at the VIN barcode");

    unmount();
    expect(stopTrack).toHaveBeenCalled();
  });

  it("programmatically labels the repaired search and scenario controls", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ToastProvider>
        <PostHistory />
      </ToastProvider>,
    );
    expect(
      screen.getByRole("searchbox", { name: "Search post history" }),
    ).toBeVisible();

    rerender(<CustomScenarioManager onSave={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add scenario" }));
    expect(screen.getByLabelText("Category")).toBeVisible();
    expect(screen.getByLabelText("Default style")).toBeVisible();
    expect(screen.getByLabelText("Default tone")).toBeVisible();
  });
});
