import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Home } from "../components/Home";
import { useAppStore } from "../stores/appStore";

const mocks = vi.hoisted(() => ({ history: vi.fn(), normalize: vi.fn() }));

vi.mock("../hooks/usePostHistoryList", () => ({
  usePostHistoryList: mocks.history,
}));

vi.mock("../utils/imageUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/imageUtils")>()),
  fileToNormalizedDataUrl: mocks.normalize,
}));

const PHOTO_URL = "data:image/jpeg;base64,cGhvdG8=";
const photoFile = (name = "car.jpg") =>
  new File(["photo"], name, { type: "image/jpeg" });

const renderHome = (props: Partial<React.ComponentProps<typeof Home>> = {}) =>
  render(
    <Home
      onPhotoPicked={vi.fn()}
      onShowHistory={vi.fn()}
      onOpenPost={vi.fn()}
      {...props}
    />,
  );

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe("Home", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
    useAppStore.setState({
      currentDealer: { id: "dealer123456789", name: "Bob Maxey Ford" },
      currentPerson: null,
      pendingPhoto: null,
    });
    mocks.history.mockReturnValue({
      filtered: [],
      loading: false,
      error: null,
      openingId: null,
      load: vi.fn(),
      openCreative: vi.fn(),
    });
    mocks.normalize.mockReset();
    mocks.normalize.mockResolvedValue(PHOTO_URL);
  });

  it("renders the approved six categories and exact mobile lead copy", () => {
    renderHome();
    expect(
      screen.getByRole("heading", { name: "Your next great post." }),
    ).toBeInTheDocument();
    expect(screen.getByText("A photo. A story. Ready to share.")).toBeInTheDocument();
    for (const label of [
      "Delivery",
      "New arrival",
      "Service",
      "Promotion",
      "Community",
      "Team",
    ]) {
      expect(
        screen.getByRole("button", { name: `${label}: take a photo` }),
      ).toBeInTheDocument();
    }
  });

  it("puts the prominent library action before the category choices", () => {
    renderHome();
    const library = screen.getByRole("button", { name: "Choose from library" });
    const delivery = screen.getByRole("button", { name: /^Delivery:/ });
    expect(
      library.compareDocumentPosition(delivery) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(library).toBeEnabled();
  });

  it("opens the matching tile camera input synchronously", () => {
    renderHome();
    const input = screen.getByLabelText("Take a photo for Delivery");
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: /^Delivery/ }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("sends a tile photo straight to that category", async () => {
    const onPhotoPicked = vi.fn();
    renderHome({ onPhotoPicked });
    const file = photoFile();

    fireEvent.change(screen.getByLabelText("Take a photo for New arrival"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(onPhotoPicked).toHaveBeenCalledTimes(1));
    expect(onPhotoPicked).toHaveBeenCalledWith(
      { workingImage: PHOTO_URL, originalSource: file, originalFilename: "car.jpg" },
      "inventory",
      "new_arrival",
    );
    expect(screen.queryByText("Pick what this photo is for")).toBeNull();
  });

  it("offers one library row on phones; the next tile tap assigns the photo", async () => {
    const onPhotoPicked = vi.fn();
    renderHome({ onPhotoPicked });

    expect(screen.getAllByRole("button", { name: "Choose from library" })).toHaveLength(
      1,
    );
    const library = screen.getByLabelText("Choose a photo from your library");
    expect(library.tabIndex).toBe(-1);
    expect(library).toHaveAttribute("aria-hidden", "true");
    const libraryClick = vi.spyOn(library, "click");
    fireEvent.click(screen.getByRole("button", { name: "Choose from library" }));
    expect(libraryClick).toHaveBeenCalledTimes(1);

    const file = photoFile("lot.jpg");
    fireEvent.change(library, { target: { files: [file] } });

    const heading = await screen.findByRole("heading", {
      name: "Pick what this photo is for",
    });
    expect(heading).toHaveFocus();
    expect(
      screen.getByText("Tap a category below to start the post."),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Your photo" })).toHaveAttribute(
      "src",
      PHOTO_URL,
    );
    // The camera line no longer describes what a tap does.
    expect(screen.queryByText("A photo. A story. Ready to share.")).toBeNull();
    expect(onPhotoPicked).not.toHaveBeenCalled();

    const camera = screen.getByLabelText("Take a photo for Service");
    const cameraClick = vi.spyOn(camera, "click");
    fireEvent.click(screen.getByRole("button", { name: "Service: use this photo" }));

    expect(cameraClick).not.toHaveBeenCalled();
    expect(onPhotoPicked).toHaveBeenCalledWith(
      { workingImage: PHOTO_URL, originalSource: file, originalFilename: "lot.jpg" },
      "service",
      "service_promotion",
    );
    expect(useAppStore.getState().pendingPhoto).toBeNull();
    expect(screen.queryByText("Pick what this photo is for")).toBeNull();
  });

  it("keeps library intake available on every device", () => {
    renderHome();
    // The top-level picker works on phones and wider screens.
    const row = screen.getByRole("button", { name: "Choose from library" })
      .parentElement as HTMLElement;
    expect(row).not.toHaveClass("md:hidden");
    expect(row).toContainElement(
      screen.getByLabelText("Choose a photo from your library"),
    );
  });

  it("removes a waiting photo so a tile opens the camera again", async () => {
    const onPhotoPicked = vi.fn();
    renderHome({ onPhotoPicked });

    fireEvent.change(screen.getByLabelText("Choose a photo from your library"), {
      target: { files: [photoFile("wrong.jpg")] },
    });
    await screen.findByRole("heading", { name: "Pick what this photo is for" });

    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));

    expect(screen.queryByText("Pick what this photo is for")).toBeNull();
    expect(useAppStore.getState().pendingPhoto).toBeNull();
    // The focused button is gone, so focus lands on the page heading.
    expect(
      screen.getByRole("heading", { name: "Your next great post." }),
    ).toHaveFocus();
    expect(screen.getByText("A photo. A story. Ready to share.")).toBeInTheDocument();

    const camera = screen.getByLabelText("Take a photo for Service");
    const cameraClick = vi.spyOn(camera, "click");
    fireEvent.click(screen.getByRole("button", { name: "Service: take a photo" }));
    expect(cameraClick).toHaveBeenCalledTimes(1);
    expect(onPhotoPicked).not.toHaveBeenCalled();
  });

  it("lets a photo restored from an earlier visit be removed too", () => {
    useAppStore.setState({
      pendingPhoto: {
        workingImage: PHOTO_URL,
        originalSource: PHOTO_URL,
        originalFilename: "old.jpg",
      },
    });
    renderHome();

    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));

    expect(screen.queryByText("Pick what this photo is for")).toBeNull();
    expect(useAppStore.getState().pendingPhoto).toBeNull();
    expect(
      screen.getByRole("button", { name: "Delivery: take a photo" }),
    ).toBeInTheDocument();
  });

  it("does not steal focus for a photo restored from an earlier visit", () => {
    useAppStore.setState({
      pendingPhoto: {
        workingImage: PHOTO_URL,
        originalSource: PHOTO_URL,
        originalFilename: "old.jpg",
      },
    });
    renderHome();

    expect(
      screen.getByRole("heading", { name: "Pick what this photo is for" }),
    ).not.toHaveFocus();
  });

  it("says the photo is being prepared while it is processed", async () => {
    const pending = deferred<string>();
    mocks.normalize.mockReturnValue(pending.promise);
    const onPhotoPicked = vi.fn();
    const { container } = renderHome({ onPhotoPicked });
    const status = screen.getAllByRole("status")[0];
    expect(status).toBeEmptyDOMElement();

    fireEvent.change(screen.getByLabelText("Take a photo for Delivery"), {
      target: { files: [photoFile()] },
    });

    const message = await screen.findByText("Getting your photo ready…");
    expect(status).toContainElement(message);
    expect(screen.queryByText("A photo. A story. Ready to share.")).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Delivery: take a photo" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose from library" })).toBeDisabled();

    await act(async () => {
      pending.resolve(PHOTO_URL);
      await pending.promise;
    });

    expect(onPhotoPicked).toHaveBeenCalledWith(
      expect.objectContaining({ workingImage: PHOTO_URL }),
      "deliveries",
      "customer_delivery",
    );
    expect(screen.queryByText("Getting your photo ready…")).toBeNull();
    expect(status).toBeEmptyDOMElement();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("labels the photo error action Dismiss, because it only clears the message", async () => {
    renderHome();
    fireEvent.change(screen.getByLabelText("Take a photo for Delivery"), {
      target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid file type. Please use an image file.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("forgets a tile whose photo failed, so the next dropped photo still asks", async () => {
    const onPhotoPicked = vi.fn();
    renderHome({ onPhotoPicked });

    fireEvent.change(screen.getByLabelText("Take a photo for Team"), {
      target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] },
    });
    await screen.findByRole("alert");

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [photoFile()] } });
    act(() => {
      window.dispatchEvent(drop);
    });

    await screen.findByRole("heading", { name: "Pick what this photo is for" });
    expect(onPhotoPicked).not.toHaveBeenCalled();
  });

  it("routes a quarantined recent record through the guarded history opener", () => {
    const openCreative = vi.fn();
    const quarantined = {
      id: "post12345678901",
      dealer: "dealer123456789",
      generated_at: "2026-10-01T12:00:00.000Z",
      scenario_id: "customer_delivery",
      customer_name: "Protected customer",
      caption: "Unsafe legacy copy",
      creative_image_url: "/api/app/posts/post12345678901/creative",
      image_review_required: true,
    };
    mocks.history.mockReturnValue({
      filtered: [quarantined],
      loading: false,
      error: null,
      openingId: null,
      load: vi.fn(),
      openCreative,
    });
    const onOpenPost = vi.fn();

    renderHome({ onOpenPost });
    fireEvent.click(
      screen.getByRole("button", { name: /Delivery.*Protected customer/ }),
    );

    expect(openCreative).toHaveBeenCalledWith(quarantined);
    expect(onOpenPost).not.toHaveBeenCalled();
  });

  it("shows useful empty, loading, and retry states for recent work", () => {
    const retry = vi.fn();
    mocks.history.mockReturnValue({
      filtered: [],
      loading: false,
      error: "Could not load your posts.",
      openingId: null,
      load: retry,
      openCreative: vi.fn(),
    });
    const { rerender } = renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);

    mocks.history.mockReturnValue({
      filtered: [],
      loading: false,
      error: null,
      openingId: null,
      load: retry,
      openCreative: vi.fn(),
    });
    rerender(
      <Home onPhotoPicked={vi.fn()} onShowHistory={vi.fn()} onOpenPost={vi.fn()} />,
    );
    // My work owns its empty-state wording; Home only needs it to say what to do.
    expect(
      screen.getByText("Choose a category to make your first post."),
    ).toBeInTheDocument();
  });
});
