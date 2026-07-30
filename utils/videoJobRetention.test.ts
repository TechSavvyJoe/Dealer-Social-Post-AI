import { describe, expect, it } from "vitest";
import { MAX_LIVE_VIDEO_JOBS, retainNewestVideoJobs } from "./videoJobRetention";

describe("live video job retention", () => {
  it("retains only the two newest jobs without mutating the source queue", () => {
    const jobs = [
      { id: "video-1", url: "blob:generated-video-1" },
      { id: "video-2", url: "blob:generated-video-2" },
      { id: "video-3", url: "blob:generated-video-3" },
    ];

    expect(MAX_LIVE_VIDEO_JOBS).toBe(2);
    expect(retainNewestVideoJobs(jobs)).toEqual(jobs.slice(1));
    expect(jobs).toHaveLength(3);
  });
});
