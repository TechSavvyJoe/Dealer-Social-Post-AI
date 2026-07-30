import React, { StrictMode } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalMediaArchive } from "../components/LocalMediaArchive";
import { RecentCaptureShelf } from "../components/RecentCaptureShelf";
import { ToastProvider } from "../components/ui/Toast";
import type { ArchivedMediaRecord } from "../utils/creativeStorage";

const storageMocks = vi.hoisted(() => ({
  listDealerMedia: vi.fn(),
  deleteArchivedMedia: vi.fn(),
  archivedMediaToDataUrl: vi.fn(),
}));

vi.mock("../utils/creativeStorage", () => ({
  MEDIA_ARCHIVE_CHANGED_EVENT: "dealer-social-media-archive-changed",
  ...storageMocks,
}));

const record = (kind: ArchivedMediaRecord["kind"]): ArchivedMediaRecord => ({
  id: `${kind}-1`,
  dealerId: "dealer-1",
  kind,
  blob: new Blob(["media"], {
    type: kind === "video" ? "video/mp4" : "image/jpeg",
  }),
  mimeType: kind === "video" ? "video/mp4" : "image/jpeg",
  fingerprint: `${kind}-fingerprint`,
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  mediaEpoch: 1,
  label: kind,
});

describe("media archive object URL lifecycle", () => {
  const createObjectURL = vi.fn<() => string>();
  const revokeObjectURL = vi.fn<(url: string) => void>();

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
    storageMocks.listDealerMedia.mockImplementation(
      async (_dealerId: string, options: { kinds?: ArchivedMediaRecord["kind"][] }) => {
        if (options.kinds?.includes("capture")) return [record("capture")];
        return [record("generated-image")];
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([
    [
      "recent captures",
      () => <RecentCaptureShelf dealerId="dealer-1" onSelect={vi.fn()} />,
    ],
    [
      "local generated media",
      () => (
        <ToastProvider>
          <LocalMediaArchive dealerId="dealer-1" />
        </ToastProvider>
      ),
    ],
  ])("revokes every URL created for %s under StrictMode", async (_label, view) => {
    const rendered = render(<StrictMode>{view()}</StrictMode>);

    await waitFor(() => expect(rendered.container.querySelector("img")).not.toBeNull());
    const created = createObjectURL.mock.results.map((result) => result.value);

    expect(created.length).toBeGreaterThan(0);
    rendered.unmount();
    expect(new Set(revokeObjectURL.mock.calls.map(([url]) => url))).toEqual(
      new Set(created),
    );
  });
});
