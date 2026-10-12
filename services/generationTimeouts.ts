// An accepted video operation gets its full polling window. The outer task
// also allows time for the start response and private media download, while
// retaining a finite deadline if either network request stops responding.
export const VIDEO_OPERATION_TIMEOUT_MS = 6 * 60_000;
export const VIDEO_TASK_TIMEOUT_MS = VIDEO_OPERATION_TIMEOUT_MS + 2 * 60_000;
