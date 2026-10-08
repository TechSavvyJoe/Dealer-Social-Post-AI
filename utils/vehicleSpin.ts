export const SPIN_FRAME_COUNT = 48;
export const SPIN_MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const SPIN_MAX_SECONDS = 180;
export const SPIN_FRAME_WIDTH = 1280;
export const SPIN_FRAME_HEIGHT = 800;

export interface SpinVehicle {
  title: string;
  vin: string;
  stock: string;
  mileage: string;
  highlights: string[];
  caption: string;
}

export type SpinBackground = "original" | "graphite" | "pearl" | "custom";

export const spinFrameAt = (index: number, count: number): number =>
  count > 0 ? ((Math.round(index) % count) + count) % count : 0;

export const spinZoom = (value: number): number =>
  Math.max(1, Math.min(3, Number.isFinite(value) ? value : 1));

export const spinSampleTimes = (
  start: number,
  end: number,
  duration: number,
  count = SPIN_FRAME_COUNT,
): number[] => {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > SPIN_MAX_SECONDS ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end > duration ||
    end - start < 4 ||
    !Number.isInteger(count) ||
    count < 24 ||
    count > 72
  )
    throw new Error(
      "Choose 4–180 seconds containing one complete turn around the vehicle.",
    );
  // Exclude the duplicate end angle so the last frame wraps to the first.
  return Array.from(
    { length: count },
    (_, index) => start + ((end - start) * index) / count,
  );
};

export const checkSpinVideo = (file: File): void => {
  if (!file.size || file.size > SPIN_MAX_VIDEO_BYTES)
    throw new Error("Choose a video under 500 MB.");
  if (
    !/^(video\/(mp4|quicktime|webm))$/i.test(file.type) &&
    !/\.(mp4|mov|webm)$/i.test(file.name)
  )
    throw new Error("Choose an MP4, MOV, or WebM video.");
};

const abortError = () => new DOMException("Processing cancelled", "AbortError");
export const checkSpinAbort = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError();
};

const mediaEvent = (
  video: HTMLVideoElement,
  name: string,
  action: () => void,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    checkSpinAbort(signal);
    const done = (error?: Error) => {
      clearTimeout(timer);
      video.removeEventListener(name, success);
      video.removeEventListener("error", failed);
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    };
    const success = () => done();
    const failed = () =>
      done(
        new Error(
          "This video could not be decoded. Try a camera recording saved as MP4.",
        ),
      );
    const aborted = () => done(abortError());
    const timer = setTimeout(
      () => done(new Error("The video took too long to load. Try a shorter clip.")),
      20000,
    );
    video.addEventListener(name, success, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", aborted, { once: true });
    try {
      action();
    } catch (error) {
      done(error instanceof Error ? error : new Error("Video could not open."));
    }
  });

export const openSpinVideo = async (file: File, signal?: AbortSignal) => {
  checkSpinVideo(file);
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const close = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  };
  try {
    await mediaEvent(
      video,
      "loadeddata",
      () => {
        video.src = url;
        video.load();
      },
      signal,
    );
    if (
      !Number.isFinite(video.duration) ||
      video.duration < 4 ||
      video.duration > SPIN_MAX_SECONDS
    )
      throw new Error(
        "Choose a 4–180 second video with one full walk around the vehicle.",
      );
    if (!video.videoWidth || !video.videoHeight)
      throw new Error("No video picture was found.");
    return {
      video,
      close,
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } catch (error) {
    close();
    throw error;
  }
};

export const canvasJpeg = (canvas: HTMLCanvasElement, quality = 0.86): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("This frame could not be saved.")),
      "image/jpeg",
      quality,
    ),
  );

export const extractSpinFrames = async (
  file: File,
  range: { start: number; end: number },
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<Blob[]> => {
  const source = await openSpinVideo(file, options.signal);
  try {
    const times = spinSampleTimes(range.start, range.end, source.duration);
    const canvas = document.createElement("canvas");
    const ratio = Math.min(
      SPIN_FRAME_WIDTH / source.width,
      SPIN_FRAME_HEIGHT / source.height,
      1,
    );
    canvas.width = Math.round(source.width * ratio);
    canvas.height = Math.round(source.height * ratio);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Your browser could not open the video editor.");
    const frames: Blob[] = [];
    for (let index = 0; index < times.length; index++) {
      checkSpinAbort(options.signal);
      if (Math.abs(source.video.currentTime - times[index]) > 0.001)
        await mediaEvent(
          source.video,
          "seeked",
          () => {
            source.video.currentTime = times[index];
          },
          options.signal,
        );
      context.drawImage(source.video, 0, 0, canvas.width, canvas.height);
      let frame = await canvasJpeg(canvas);
      if (frame.size > 450000) frame = await canvasJpeg(canvas, 0.65);
      if (frame.size > 500000)
        throw new Error(
          "This video is too detailed for a smooth spin. Try a 1080p recording.",
        );
      frames.push(frame);
      options.onProgress?.((index + 1) / times.length);
    }
    checkSpinAbort(options.signal);
    return frames;
  } finally {
    source.close();
  }
};
