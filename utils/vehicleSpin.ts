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
  // WebKit may report loadeddata for a detached video while its drawable
  // surface is still empty. Keep the decoder attached while preparing frames.
  video.setAttribute("aria-hidden", "true");
  video.tabIndex = -1;
  video.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.001;pointer-events:none";
  document.body.appendChild(video);
  const close = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
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

/** Prime the drawable surface once; subsequent samples use the active paused seek. */
export const waitForSpinFrame = (
  video: HTMLVideoElement,
  signal?: AbortSignal,
  targetTime?: number,
): Promise<void> =>
  new Promise((resolve, reject) => {
    checkSpinAbort(signal);
    let settled = false;
    let frameCallback: number | undefined;
    let animationFrame: number | undefined;
    const presentationStarted = performance.now();
    const drawable = () =>
      !video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback);
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      video.removeEventListener("error", failed);
      video.removeEventListener("playing", playing);
      video.removeEventListener("seeked", seeked);
      signal?.removeEventListener("abort", aborted);
      video.pause();
      if (error) reject(error);
      else resolve();
    };
    const failed = () =>
      done(
        new Error(
          "This video could not be decoded. Try a camera recording saved as MP4.",
        ),
      );
    const aborted = () => done(abortError());
    const afterPaint = (ready: () => boolean) => {
      if (settled) return;
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      let readyPaints = 0;
      const paint = () => {
        if (settled) return;
        readyPaints = ready() ? readyPaints + 1 : 0;
        if (readyPaints === 2) {
          done();
          return;
        }
        // Target data may become available after a paint without another media
        // event. Keep observing within the same deadline, rather than stranding
        // a drawable frame until the watchdog rejects it.
        animationFrame = requestAnimationFrame(paint);
      };
      animationFrame = requestAnimationFrame(paint);
    };
    const targetSelected = () =>
      targetTime !== undefined && Math.abs(video.currentTime - targetTime) <= 0.001;
    const atTarget = () => drawable() && targetSelected();
    const seeked = () => {
      // A changed target still needs its completed seek boundary. Transiently
      // missing data may then recover while the paint observer is active.
      if (!video.seeking && targetSelected()) afterPaint(atTarget);
    };
    // The seeking algorithm waits for target data and decoding before seeked.
    // Once the surface is primed, paused seek + paint handles quantized/VFR
    // frames and the source tail without requiring a future presentation.
    const playing = () => afterPaint(drawable);
    const timer = setTimeout(
      () =>
        done(
          new Error("The video picture took too long to decode. Try a shorter clip."),
        ),
      20000,
    );
    video.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", aborted, { once: true });
    video.pause();
    try {
      if (targetTime !== undefined) {
        video.addEventListener("seeked", seeked);
        // Do not reassign the same timestamp just because decoding is pending.
        // Poll the primed surface, checking seeking/readiness on every paint.
        if (targetSelected()) afterPaint(atTarget);
        else video.currentTime = targetTime;
        return;
      }
      // loadeddata alone can leave WebKit's initial drawable surface empty.
      // Only the one-time prime uses playback and compositor synchronization.
      const presented: VideoFrameRequestCallback = (_now, metadata) => {
        if (settled) return;
        if (
          !Number.isFinite(metadata.mediaTime) ||
          !Number.isFinite(metadata.presentationTime) ||
          metadata.presentationTime < presentationStarted ||
          !drawable()
        ) {
          frameCallback = video.requestVideoFrameCallback(presented);
          return;
        }
        done();
      };
      if (typeof video.requestVideoFrameCallback === "function")
        frameCallback = video.requestVideoFrameCallback(presented);
      else video.addEventListener("playing", playing, { once: true });
      void video.play().catch(failed);
    } catch {
      failed();
    }
  });

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
    await waitForSpinFrame(source.video, options.signal);
    // Prime playback can leave a later drawable frame while the logical clock
    // still equals the first sample. WebKit may skip the media engine for a
    // seek to that same time. Position through the next planned in-range sample
    // once, so the loop's first seek back really replaces the primed surface.
    if (Math.abs(source.video.currentTime - times[0]) <= 0.001)
      await waitForSpinFrame(source.video, options.signal, times[1]);
    for (let index = 0; index < times.length; index++) {
      checkSpinAbort(options.signal);
      await waitForSpinFrame(source.video, options.signal, times[index]);
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
