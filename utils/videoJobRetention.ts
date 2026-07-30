export const MAX_LIVE_VIDEO_JOBS = 2;

/**
 * Bound live in-memory render state for mobile browsers. Completed media is
 * archived separately; callers retain only the newest jobs and let their blob
 * ownership cleanup revoke URLs that fall out of this window.
 */
export function retainNewestVideoJobs<T>(jobs: readonly T[]): T[] {
  return jobs.slice(-MAX_LIVE_VIDEO_JOBS);
}
