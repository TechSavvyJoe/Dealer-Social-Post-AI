import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchivedMediaRecord } from "../utils/creativeStorage";

const storageMocks = vi.hoisted(() => ({
  listDealerMedia: vi.fn(),
  deleteArchivedMedia: vi.fn(),
  archivedMediaToDataUrl: vi.fn(),
}));

const mediaSaveMocks = vi.hoisted(() => ({
  savePreparedMediaToLibrary: vi.fn(),
}));

vi.mock("../utils/creativeStorage", () => ({
  MEDIA_ARCHIVE_CHANGED_EVENT: "dealer-social-media-archive-changed",
  ...storageMocks,
}));

vi.mock("../utils/mediaSave", () => mediaSaveMocks);

import { useDeviceMedia } from "./useDeviceMedia";

const record = (id: string): ArchivedMediaRecord => ({
  id,
  dealerId: "dealer-1",
  kind: "generated-image",
  blob: new Blob(["media"], { type: "image/jpeg" }),
  mimeType: "image/jpeg",
  fingerprint: `${id}-fingerprint`,
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  mediaEpoch: 1,
  label: "generated-image",
});

describe("useDeviceMedia", () => {
  const createObjectURL = vi.fn<() => string>();
  const revokeObjectURL = vi.fn<(url: string) => void>();
  const KINDS = ["generated-image" as const];

  beforeEach(() => {
    let sequence = 0;
    createObjectURL.mockImplementation(() => `blob:preview-${++sequence}`);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    storageMocks.listDealerMedia.mockResolvedValue([record("a"), record("b")]);
    storageMocks.deleteArchivedMedia.mockResolvedValue(true);
    storageMocks.archivedMediaToDataUrl.mockResolvedValue(
      "data:image/jpeg;base64,AAAA",
    );
    mediaSaveMocks.savePreparedMediaToLibrary.mockResolvedValue({
      method: "download",
      kind: "image",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists records for the requested kinds and creates one preview URL per record", async () => {
    const { result } = renderHook(() =>
      useDeviceMedia({ dealerId: "dealer-1", kinds: KINDS, limit: 12 }),
    );

    await waitFor(() => expect(result.current.records).toHaveLength(2));
    expect(storageMocks.listDealerMedia).toHaveBeenCalledWith("dealer-1", {
      kinds: KINDS,
      limit: 12,
    });
    await waitFor(() => expect(result.current.previews).toHaveLength(2));
    expect(createObjectURL).toHaveBeenCalledTimes(2);
  });

  it("revokes every created object URL on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useDeviceMedia({ dealerId: "dealer-1", kinds: KINDS, limit: 12 }),
    );

    await waitFor(() => expect(result.current.previews).toHaveLength(2));
    const created = createObjectURL.mock.results.map((r) => r.value);
    expect(created.length).toBeGreaterThan(0);

    unmount();

    expect(new Set(revokeObjectURL.mock.calls.map(([url]) => url))).toEqual(
      new Set(created),
    );
  });

  it("revokes the previous preview URLs when the record list changes", async () => {
    storageMocks.listDealerMedia.mockResolvedValueOnce([record("a")]);
    const { result, rerender } = renderHook(
      ({ dealerId }: { dealerId: string }) =>
        useDeviceMedia({ dealerId, kinds: KINDS, limit: 12 }),
      { initialProps: { dealerId: "dealer-1" } },
    );

    await waitFor(() => expect(result.current.previews).toHaveLength(1));
    const firstUrl = result.current.previews[0].url;

    storageMocks.listDealerMedia.mockResolvedValueOnce([record("a"), record("b")]);
    rerender({ dealerId: "dealer-2" });

    await waitFor(() => expect(result.current.previews).toHaveLength(2));
    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl);
  });

  it("delete wraps deleteArchivedMedia", async () => {
    const { result } = renderHook(() =>
      useDeviceMedia({ dealerId: "dealer-1", kinds: KINDS, limit: 12 }),
    );
    await waitFor(() => expect(result.current.records).toHaveLength(2));

    await act(async () => {
      await result.current.remove("a");
    });

    expect(storageMocks.deleteArchivedMedia).toHaveBeenCalledWith("a");
  });

  it("save wraps savePreparedMediaToLibrary", async () => {
    const { result } = renderHook(() =>
      useDeviceMedia({ dealerId: "dealer-1", kinds: KINDS, limit: 12 }),
    );
    await waitFor(() => expect(result.current.records).toHaveLength(2));

    const prepared = {
      kind: "image" as const,
      filename: "test.jpg",
      file: new File(["x"], "test.jpg", { type: "image/jpeg" }),
    };
    await act(async () => {
      await result.current.save(prepared);
    });

    expect(mediaSaveMocks.savePreparedMediaToLibrary).toHaveBeenCalledWith(prepared);
  });

  it("reacts to the logout purge event by reloading", async () => {
    const { result } = renderHook(() =>
      useDeviceMedia({ dealerId: "dealer-1", kinds: KINDS, limit: 12 }),
    );
    await waitFor(() => expect(result.current.records).toHaveLength(2));

    storageMocks.listDealerMedia.mockResolvedValueOnce([]);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("dealer-social-media-archive-changed", {
          detail: { dealerId: "dealer-1" },
        }),
      );
    });

    await waitFor(() => expect(result.current.records).toHaveLength(0));
  });
});
