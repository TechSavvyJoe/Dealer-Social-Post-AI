import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostDetails } from "../components/PostDetails";
import { useAppStore } from "../stores/appStore";

// Production records a used signature only in useGeneration's private
// registry (never by setting `linked` on the release), so the tests drive the
// same signal PostDetails reads: isReleaseAlreadyLinked.
const linked = vi.hoisted(() => ({ set: new WeakSet<object>() }));

vi.mock("../hooks/useGeneration", () => ({
  isReleaseAlreadyLinked: (release: object | null | undefined) =>
    Boolean(release && linked.set.has(release)),
}));

// Most gates come from the real request builder; a test can force one the
// store setup cannot easily reach (no place to share).
const gate = vi.hoisted(() => ({
  override: null as null | { ok: false; reason: "no_destination" },
}));

vi.mock("../services/generationRequest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/generationRequest")>();
  return {
    ...actual,
    buildGenerationRequest: (
      input: Parameters<typeof actual.buildGenerationRequest>[0],
    ) => gate.override ?? actual.buildGenerationRequest(input),
  };
});

vi.mock("../services/websitePublishing", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../services/websitePublishing")>();
  return { ...original, listWebsiteDestinations: vi.fn().mockResolvedValue([]) };
});

// The real scanner needs a camera and the VIN decoder; a stand-in hands back a
// decoded vehicle so the release/VIN binding can be exercised.
vi.mock("../components/VinScanner", () => ({
  VinScanner: ({
    isOpen,
    onVehicleDecoded,
    onClose,
  }: {
    isOpen: boolean;
    onVehicleDecoded: (vehicle: { vin: string; summary?: string }) => void;
    onClose: () => void;
  }) =>
    isOpen ? (
      <button
        type="button"
        onClick={() => {
          onVehicleDecoded({ vin: "1FTFW1E50NFA99999", summary: "2024 Ford F-150" });
          onClose();
        }}
      >
        Use scanned vehicle
      </button>
    ) : null,
}));

const SPENT_COPY = "This signature was used for your last post — get a new signature";

const renderDetails = (props: Partial<React.ComponentProps<typeof PostDetails>> = {}) =>
  render(
    <PostDetails
      imageSrc="data:image/jpeg;base64,photo"
      onGenerate={vi.fn()}
      onBack={vi.fn()}
      onChangePhoto={vi.fn()}
      {...props}
    />,
  );

const signatureRow = () =>
  screen.getByRole("button", { name: /^Customer's signature/ });

describe("PostDetails", () => {
  beforeEach(() => {
    linked.set = new WeakSet();
    gate.override = null;
    // The sheet's signature pad needs a 2D context jsdom does not have.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    useAppStore.setState({
      currentDealer: { id: "dealer123456789", name: "Bob Maxey Ford" },
      currentPerson: null,
      role: "salesperson",
      postDraft: { categoryId: "deliveries", scenarioId: "customer_delivery" },
      pendingRelease: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("makes getting the signature the one action until the customer signs", () => {
    const onGenerate = vi.fn();
    renderDetails({ onGenerate });

    // Fail closed: there is no Create post to press, only the next step.
    expect(
      screen.queryByRole("button", { name: "Create post" }),
    ).not.toBeInTheDocument();
    const primary = screen.getByRole("button", { name: "Get customer's signature" });
    expect(primary).toBeEnabled();
    expect(primary).not.toHaveAttribute("aria-disabled");
    expect(within(signatureRow()).getByText("Needed")).toBeInTheDocument();

    // The primary shortcut follows the primary: it opens the sheet, never generation.
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(onGenerate).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Customer photo release" }),
    ).toBeInTheDocument();
  });

  it("opens the same sheet from the signature row and the primary", () => {
    renderDetails();
    fireEvent.click(signatureRow());
    expect(
      screen.getByRole("dialog", { name: "Customer photo release" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Get customer's signature" }));
    expect(
      screen.getByRole("dialog", { name: "Customer photo release" }),
    ).toBeInTheDocument();
  });

  it("shows a signed release as Signed with the customer's name", async () => {
    useAppStore.setState({
      pendingRelease: {
        customerName: "Maria Lopez",
        signaturePngDataUrl: "data:image/png;base64,signed",
        linked: false,
      },
    });
    renderDetails();
    await act(async () => {
      await Promise.resolve();
    });

    const row = signatureRow();
    expect(within(row).getByText("Signed")).toBeInTheDocument();
    expect(within(row).getByText("Maria Lopez")).toBeInTheDocument();
    expect(within(row).queryByText("Needed")).not.toBeInTheDocument();
    expect(screen.queryByText(/Signed ·/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create post" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Get customer's signature" }),
    ).not.toBeInTheDocument();
  });

  it("passes the exact pending release object into generation", async () => {
    const pendingRelease = {
      customerName: "Maria Lopez",
      signaturePngDataUrl: "data:image/png;base64,signed",
      linked: false,
    };
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ pendingRelease });
    renderDetails({ onGenerate });
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create post" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create post" }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate.mock.calls[0][5].capturedRelease).toBe(pendingRelease);
  });

  /** A used signature must read as Needed and route the primary to a new one. */
  const expectSignatureNeededAgain = (onGenerate: ReturnType<typeof vi.fn>) => {
    // Never "Signed" next to a demand for a new signature.
    const row = signatureRow();
    expect(within(row).getByText("Needed")).toBeInTheDocument();
    expect(within(row).queryByText("Signed")).not.toBeInTheDocument();
    expect(within(row).queryByText("Maria Lopez")).not.toBeInTheDocument();
    expect(screen.queryByText(/Signed ·/)).not.toBeInTheDocument();
    expect(screen.getByText(SPENT_COPY)).toHaveAttribute("id", "create-post-reason");
    expect(
      screen.queryByRole("button", { name: "Create post" }),
    ).not.toBeInTheDocument();

    const primary = screen.getByRole("button", { name: "Get customer's signature" });
    expect(primary).toBeEnabled();
    expect(primary).toHaveAttribute("aria-describedby", "create-post-reason");
    fireEvent.click(primary);
    expect(onGenerate).not.toHaveBeenCalled();
    const sheet = screen.getByRole("dialog", { name: "Customer photo release" });
    // The name survives only as the sheet's prefill.
    expect(within(sheet).getByLabelText("Customer's full name")).toHaveValue(
      "Maria Lopez",
    );
  };

  it("treats a signature already used for the last post as needed again", () => {
    const onGenerate = vi.fn();
    // Back from Post returns here with the same release object; generation
    // recorded it as used without touching its `linked` field.
    const release = {
      customerName: "Maria Lopez",
      signaturePngDataUrl: "data:image/png;base64,signed",
      releaseId: "release-1",
      linked: false,
    };
    linked.set.add(release);
    useAppStore.setState({ pendingRelease: release });
    renderDetails({ onGenerate });

    expectSignatureNeededAgain(onGenerate);
  });

  it("also treats a release flagged as linked as needed again", () => {
    const onGenerate = vi.fn();
    useAppStore.setState({
      pendingRelease: {
        customerName: "Maria Lopez",
        signaturePngDataUrl: "data:image/png;base64,signed",
        releaseId: "release-1",
        linked: true,
      },
    });
    renderDetails({ onGenerate });

    expectSignatureNeededAgain(onGenerate);
  });

  it("asks for a new signature when the signed one no longer matches the vehicle", () => {
    const onGenerate = vi.fn();
    useAppStore.setState({
      postDraft: {
        categoryId: "deliveries",
        scenarioId: "customer_delivery",
        decodedVehicle: {
          vin: "1FTFW1E50NFA99999",
          summary: "2024 Ford F-150",
          empty: false,
        },
      },
      pendingRelease: {
        customerName: "Maria Lopez",
        signaturePngDataUrl: "data:image/png;base64,signed",
        vin: "1FTFW1E50NFA12345",
        linked: false,
      },
    });
    renderDetails({ onGenerate });

    const row = signatureRow();
    expect(within(row).getByText("Needed")).toBeInTheDocument();
    expect(within(row).queryByText("Signed")).not.toBeInTheDocument();
    expect(document.getElementById("create-post-reason")).toHaveTextContent(
      "The signature no longer matches this customer or vehicle — get a new signature.",
    );
    // One primary that says what happens next, not a disabled Create post.
    expect(
      screen.queryByRole("button", { name: "Create post" }),
    ).not.toBeInTheDocument();
    const primary = screen.getByRole("button", { name: "Get customer's signature" });
    expect(primary).toBeEnabled();
    expect(primary).toHaveAttribute("aria-describedby", "create-post-reason");
    fireEvent.click(primary);
    expect(onGenerate).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Customer photo release" }),
    ).toBeInTheDocument();
  });

  it("tells a salesperson to ask their manager when there is no place to share", async () => {
    gate.override = { ok: false, reason: "no_destination" };
    renderDetails();
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.getElementById("create-post-reason")).toHaveTextContent(
      "No place to share is set up for your store yet. Ask your manager.",
    );
    expect(screen.getByRole("button", { name: "Create post" })).toBeDisabled();
  });

  it("tells a manager where to add a place to share instead of to ask a manager", async () => {
    gate.override = { ok: false, reason: "no_destination" };
    useAppStore.setState({ role: "dealer_admin" });
    renderDetails();
    await act(async () => {
      await Promise.resolve();
    });
    const reason = document.getElementById("create-post-reason");
    expect(reason).toHaveTextContent(
      "No place to share is set up for your store yet. Add one in dealership setup.",
    );
    expect(reason).not.toHaveTextContent(/Ask your manager/);
  });

  it("reserves the phone action bar's measured height so it never covers the form", () => {
    const observers: Array<{ callback: ResizeObserverCallback; targets: Element[] }> =
      [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private entry: { callback: ResizeObserverCallback; targets: Element[] };
        constructor(callback: ResizeObserverCallback) {
          this.entry = { callback, targets: [] };
          observers.push(this.entry);
        }
        observe(target: Element) {
          this.entry.targets.push(target);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const { container } = renderDetails();
    const page = container.firstElementChild as HTMLElement;
    const bar = screen.getByRole("button", { name: "Get customer's signature" })
      .parentElement as HTMLElement;
    // Until it is measured the page keeps the fixed fallback padding.
    expect(page.style.getPropertyValue("--details-bar-space")).toBe("");

    const observer = observers.find((entry) => entry.targets.includes(bar));
    expect(observer).toBeDefined();
    // A long gate reason wrapped on a 320 px phone: the bar grows to 164 px.
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      height: 163.6,
    } as DOMRect);
    act(() => observer?.callback([], {} as ResizeObserver));
    expect(page.style.getPropertyValue("--details-bar-space")).toBe("188px");
  });

  it("disables Create post and says why for any other gate", () => {
    const onGenerate = vi.fn();
    useAppStore.setState({
      postDraft: {
        categoryId: "deliveries",
        scenarioId: "customer_delivery",
        personalLine: "Congratulations to Jordan Price on the new truck!",
      },
      pendingRelease: {
        customerName: "Maria Lopez",
        signaturePngDataUrl: "data:image/png;base64,signed",
        linked: false,
      },
    });
    renderDetails({ onGenerate });

    const create = screen.getByRole("button", { name: "Create post" });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute("aria-describedby", "create-post-reason");
    const reason = document.getElementById("create-post-reason");
    expect(reason).toHaveTextContent(/name someone other than Maria/);
    expect(reason).toHaveClass("text-warning-ink");
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("puts the vehicle above the signature so a scan never voids a signature", () => {
    renderDetails();
    const vehicle = screen.getByRole("button", { name: /^Vehicle/ });
    expect(within(vehicle).getByText("Optional")).toBeInTheDocument();
    expect(within(vehicle).getByText("Scan VIN")).toBeInTheDocument();
    expect(
      vehicle.compareDocumentPosition(signatureRow()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([
    ["service", "service_promotion"],
    ["promotions", "model_year_end"],
    ["community", "community_event"],
    ["team", "team_anniversary"],
  ] as const)(
    "offers optional VIN scanning for %s image and video details",
    (categoryId, scenarioId) => {
      useAppStore.setState({ postDraft: { categoryId, scenarioId } });
      renderDetails();
      fireEvent.click(screen.getByRole("button", { name: /^Vehicle/ }));
      fireEvent.click(screen.getByRole("button", { name: "Use scanned vehicle" }));
      expect(useAppStore.getState().postDraft?.decodedVehicle?.vin).toBe(
        "1FTFW1E50NFA99999",
      );
      expect(screen.getByRole("button", { name: /^Vehicle/ })).toHaveTextContent(
        "2024 Ford F-150",
      );
    },
  );

  it("asks for the signature again when the vehicle changes after signing", () => {
    useAppStore.setState({
      pendingRelease: {
        customerName: "Maria Lopez",
        signaturePngDataUrl: "data:image/png;base64,signed",
        linked: false,
      },
    });
    renderDetails();
    fireEvent.click(screen.getByRole("button", { name: /^Vehicle/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use scanned vehicle" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You changed the vehicle, so the customer needs to sign again.",
    );
    expect(useAppStore.getState().pendingRelease).toBeNull();
    expect(within(signatureRow()).getByText("Needed")).toBeInTheDocument();
  });

  it("names the error action for what it does", () => {
    const onDismissError = vi.fn();
    renderDetails({ error: "Something went wrong.", onDismissError });
    expect(screen.queryByRole("button", { name: /Try again/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it("says a stopped create kept the photo and details, in plain words", async () => {
    useAppStore.setState({
      pendingRelease: {
        customerName: "Maria Lopez",
        signaturePngDataUrl: "data:image/png;base64,signed",
        linked: false,
      },
    });
    renderDetails({ onGenerate: vi.fn().mockRejectedValue(new Error("network")) });
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create post" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create post" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Creating the post stopped. Your photo and details are still here.",
    );
  });

  it("names the page by its category and keeps the photo picker out of the tab order", () => {
    const { container } = renderDetails();
    expect(
      screen.getByRole("heading", { level: 1, name: "Delivery" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Delivery photo" })).toBeInTheDocument();
    const picker = container.querySelector('input[type="file"]');
    expect(picker).toHaveAttribute("tabindex", "-1");
    expect(picker).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Change photo" })).toBeInTheDocument();
  });

  it("hides the signature row for a non-customer category", async () => {
    useAppStore.setState({
      postDraft: { categoryId: "service", scenarioId: "service_promotion" },
    });
    renderDetails();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Customer's signature")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Get customer's signature" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create post" })).toBeEnabled();
  });
  it("waits for destination discovery and offers a retry after discovery fails", async () => {
    const { listWebsiteDestinations } = await import("../services/websitePublishing");
    let reject!: (reason: unknown) => void;
    vi.mocked(listWebsiteDestinations).mockReturnValueOnce(
      new Promise((_resolve, r) => {
        reject = r;
      }),
    );
    useAppStore.setState({
      postDraft: { categoryId: "inventory", scenarioId: "new_arrival" },
    });
    const onGenerate = vi.fn();
    renderDetails({ onGenerate });
    const create = screen.getByRole("button", { name: "Create post" });
    expect(create).toBeDisabled();
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(onGenerate).not.toHaveBeenCalled();
    await act(async () => {
      reject(new Error("offline"));
    });
    expect(screen.getByRole("button", { name: "Create social post" })).toBeEnabled();
    expect(screen.getByText(/Website destinations are unavailable/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry destinations" }));
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it("can create only social output when website discovery is unavailable", async () => {
    const { listWebsiteDestinations } = await import("../services/websitePublishing");
    vi.mocked(listWebsiteDestinations).mockRejectedValueOnce(new Error("offline"));
    useAppStore.setState({
      postDraft: { categoryId: "inventory", scenarioId: "new_arrival" },
    });
    const onGenerate = vi.fn();
    renderDetails({ onGenerate });
    const create = await screen.findByRole("button", { name: "Create social post" });
    fireEvent.click(create);
    await waitFor(() => expect(onGenerate).toHaveBeenCalledOnce());
    expect(onGenerate.mock.calls[0][5].websiteEnabled).toBe(false);
    expect(onGenerate.mock.calls[0][6].length).toBeGreaterThan(0);
  });

  it("does not bypass missing social destinations after website discovery fails", async () => {
    const { listWebsiteDestinations } = await import("../services/websitePublishing");
    vi.mocked(listWebsiteDestinations).mockRejectedValueOnce(new Error("offline"));
    gate.override = { ok: false, reason: "no_destination" };
    useAppStore.setState({
      postDraft: { categoryId: "inventory", scenarioId: "new_arrival" },
    });
    const onGenerate = vi.fn();
    renderDetails({ onGenerate });
    await screen.findByRole("button", { name: "Retry destinations" });
    expect(screen.getByRole("button", { name: "Create post" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "uses the destination's enabled flag for website generation (%s)",
    async (enabled) => {
      const { listWebsiteDestinations } = await import("../services/websitePublishing");
      vi.mocked(listWebsiteDestinations).mockResolvedValueOnce([
        {
          id: "customer-hub",
          label: "Customer Hub",
          siteUrl: "https://example.com",
          enabled,
          mode: "private_draft",
        },
      ]);
      useAppStore.setState({
        postDraft: { categoryId: "inventory", scenarioId: "new_arrival" },
      });
      const onGenerate = vi.fn();
      renderDetails({ onGenerate });
      const create = screen.getByRole("button", { name: "Create post" });
      await waitFor(() => expect(create).toBeEnabled());
      fireEvent.click(create);
      expect(onGenerate).toHaveBeenCalledOnce();
      expect(onGenerate.mock.lastCall?.[5]).toEqual(
        expect.objectContaining({ websiteEnabled: enabled }),
      );
    },
  );
});
