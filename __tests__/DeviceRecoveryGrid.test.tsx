import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceRecoveryGrid } from "../components/work/DeviceRecoveryGrid";
import type { ArchivedMediaRecord } from "../utils/creativeStorage";

const mocks = vi.hoisted(() => ({
  device: vi.fn(),
  remove: vi.fn(),
  save: vi.fn(),
  toDataUrl: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../hooks/useDeviceMedia", () => ({ useDeviceMedia: mocks.device }));
vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: vi.fn(),
  }),
}));

const record = (
  id: string,
  kind: ArchivedMediaRecord["kind"],
  overrides: Partial<ArchivedMediaRecord> = {},
): ArchivedMediaRecord => ({
  id,
  dealerId: "dealer-1",
  kind,
  blob: new Blob([id], { type: kind === "video" ? "video/mp4" : "image/jpeg" }),
  mimeType: kind === "video" ? "video/mp4" : "image/jpeg",
  fingerprint: `fp-${id}`,
  createdAt: new Date(2026, 9, 5, 15, 12).getTime(),
  expiresAt: new Date(2026, 9, 7, 15, 12).getTime(),
  mediaEpoch: 0,
  label: kind,
  ...overrides,
});

const original = record("media-original", "capture", {
  originalFilename: "IMG_2048.jpg",
});
const postImage = record("media-post", "generated-image");
const video = record("media-video", "video");

const showRecords = (...records: ArchivedMediaRecord[]) =>
  mocks.device.mockReturnValue({
    records,
    previews: records.map((item) => ({ record: item, url: `blob:${item.id}` })),
    reload: vi.fn(),
    remove: mocks.remove,
    save: mocks.save,
    toDataUrl: mocks.toDataUrl,
  });

describe("DeviceRecoveryGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remove.mockResolvedValue(true);
    mocks.save.mockResolvedValue({ method: "download", kind: "image" });
    mocks.toDataUrl.mockResolvedValue("data:image/jpeg;base64,b3JpZ2luYWw=");
    showRecords(original, postImage, video);
  });

  it("lists original photos in their own group, labelled Original photo", () => {
    render(<DeviceRecoveryGrid dealerId="dealer-1" onReusePhoto={vi.fn()} />);

    expect(mocks.device).toHaveBeenCalledWith(
      expect.objectContaining({
        dealerId: "dealer-1",
        kinds: expect.arrayContaining(["capture", "generated-image", "video"]),
      }),
    );
    const originals = screen.getByRole("list", { name: "Original photos" });
    expect(within(originals).getByText("Original photo")).toBeVisible();
    expect(within(originals).getAllByRole("listitem")).toHaveLength(1);
    const made = screen.getByRole("list", { name: "Post images and videos" });
    expect(within(made).getByText("Post image")).toBeVisible();
    expect(within(made).getByText("Video")).toBeVisible();
    expect(within(made).queryByText("Original photo")).not.toBeInTheDocument();
  });

  it("offers Reuse for originals only and feeds the original back in", async () => {
    const onReusePhoto = vi.fn();
    render(<DeviceRecoveryGrid dealerId="dealer-1" onReusePhoto={onReusePhoto} />);

    const reuse = screen.getAllByRole("button", { name: /^Reuse/ });
    expect(reuse).toHaveLength(1);
    expect(
      within(screen.getByRole("list", { name: "Original photos" })).getByRole(
        "button",
        { name: /^Reuse original photo/ },
      ),
    ).toBe(reuse[0]);

    fireEvent.click(reuse[0]);
    await waitFor(() => expect(onReusePhoto).toHaveBeenCalledTimes(1));
    expect(mocks.toDataUrl).toHaveBeenCalledWith(original);
    expect(onReusePhoto).toHaveBeenCalledWith({
      workingImage: "data:image/jpeg;base64,b3JpZ2luYWw=",
      originalSource: original.blob,
      originalFilename: "IMG_2048.jpg",
    });
  });

  it("keeps Save and Delete for every recovery copy", async () => {
    render(<DeviceRecoveryGrid dealerId="dealer-1" onReusePhoto={vi.fn()} />);

    expect(screen.getAllByRole("button", { name: /^Save / })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Delete / })).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /^Save post image from/ }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "image",
        filename: "dealer-social-media-post.jpg",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /^Save video from/ }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "video",
        filename: "dealer-social-media-video.mp4",
      }),
    );
  });

  it("shows Save working on its own row while the save runs", async () => {
    let finish!: (value: { method: string; kind: string }) => void;
    mocks.save.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<DeviceRecoveryGrid dealerId="dealer-1" onReusePhoto={vi.fn()} />);

    const savePost = screen.getByRole("button", { name: /^Save post image from/ });
    const saveVideo = screen.getByRole("button", { name: /^Save video from/ });
    expect(savePost).not.toHaveAttribute("aria-busy");
    fireEvent.click(savePost);

    await waitFor(() => expect(savePost).toHaveAttribute("aria-busy", "true"));
    expect(savePost).toBeDisabled();
    expect(saveVideo).not.toHaveAttribute("aria-busy");
    expect(
      screen.getByRole("button", { name: /^Reuse original photo/ }),
    ).not.toHaveAttribute("aria-busy");

    await act(async () => finish({ method: "download", kind: "image" }));
    expect(savePost).not.toHaveAttribute("aria-busy");
    expect(savePost).toBeEnabled();
  });

  it("plays a recovered video from its tile, which paints a first frame", () => {
    render(<DeviceRecoveryGrid dealerId="dealer-1" onReusePhoto={vi.fn()} />);

    const tile = screen.getByRole("button", { name: /^Play video from/ });
    expect(tile.querySelector("video")).toHaveAttribute(
      "src",
      "blob:media-video#t=0.1",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(tile);
    const player = screen.getByRole("dialog", { name: /^Video from/ });
    const video = player.querySelector("video");
    expect(video).toHaveAttribute("src", "blob:media-video");
    expect(video).toHaveAttribute("controls");
  });

  it("deletes only after confirmation", async () => {
    render(<DeviceRecoveryGrid dealerId="dealer-1" onReusePhoto={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", { name: /^Delete original photo from/ }),
    );
    const dialog = screen.getByRole("dialog", { name: "Delete recovery copy" });
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("media-original"));
  });

  it("names the group for what is in it and renders nothing when empty", () => {
    showRecords(postImage);
    const { unmount } = render(
      <DeviceRecoveryGrid dealerId="dealer-1" onReusePhoto={vi.fn()} />,
    );
    expect(screen.getByRole("list", { name: "Post images" })).toBeVisible();
    expect(
      screen.queryByRole("list", { name: "Original photos" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reuse/ })).not.toBeInTheDocument();
    unmount();

    showRecords();
    const { container } = render(
      <DeviceRecoveryGrid dealerId="dealer-1" onReusePhoto={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
