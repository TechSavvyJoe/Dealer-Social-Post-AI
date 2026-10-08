import { checkSpinAbort, type SpinVehicle } from "./vehicleSpin";

export const spinRecordingType = (): {
  mimeType: string;
  extension: "mp4" | "webm";
} | null => {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mimeType of [
    "video/mp4;codecs=avc1.42001E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ])
    if (MediaRecorder.isTypeSupported(mimeType))
      return { mimeType, extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm" };
  return null;
};

const lines = (
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
  max: number,
): string[] => {
  const result: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const next = current ? current + " " + word : word;
    if (context.measureText(next).width > width && current) {
      result.push(current);
      current = word;
    } else current = next;
  }
  if (current) result.push(current);
  return result.slice(0, max).map((line, index) => {
    const omitted = index === max - 1 && result.length > max;
    let value = line + (omitted ? "…" : "");
    while (context.measureText(value).width > width && value.length)
      value = value.slice(0, -1);
    return value === line || value === line + "…" ? value : value.slice(0, -1) + "…";
  });
};

/** Render only saved, approval-checked frames and facts supplied by the caller. */
export const exportSpinVideo = async (
  frames: Blob[],
  vehicle: SpinVehicle,
  dealerName: string,
  format: "portrait" | "landscape",
  options: { signal: AbortSignal; onProgress: (fraction: number) => void },
): Promise<File> => {
  const encoding = spinRecordingType();
  if (!encoding || !HTMLCanvasElement.prototype.captureStream)
    throw new Error(
      "This browser cannot export video. Open this saved spin in Safari or Chrome on a supported device.",
    );
  if (frames.length < 24) throw new Error("This spin is missing angles.");
  checkSpinAbort(options.signal);
  const canvas = document.createElement("canvas");
  canvas.width = format === "portrait" ? 1080 : 1920;
  canvas.height = format === "portrait" ? 1920 : 1080;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Video renderer unavailable.");
  await document.fonts.ready;
  const portrait = format === "portrait";
  const margin = portrait ? 64 : 72;
  const photo = portrait
    ? { x: 0, y: 240, width: 1080, height: 850 }
    : { x: 0, y: 150, width: 1200, height: 780 };
  const infoX = portrait ? margin : 1272;
  const infoY = portrait ? 1210 : 280;
  const infoWidth = portrait
    ? canvas.width - margin * 2
    : canvas.width - infoX - margin;
  const draw = (image: ImageBitmap) => {
    context.fillStyle = "#101317";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#c5ccd5";
    context.font = "500 28px Inter, sans-serif";
    context.fillText(
      dealerName.slice(0, 70),
      margin,
      portrait ? 120 : 96,
      canvas.width - margin * 2,
    );
    context.fillStyle = "#578bff";
    context.fillRect(margin, portrait ? 158 : 123, 56, 4);
    const ratio = Math.min(photo.width / image.width, photo.height / image.height);
    context.drawImage(
      image,
      photo.x + (photo.width - image.width * ratio) / 2,
      photo.y + (photo.height - image.height * ratio) / 2,
      image.width * ratio,
      image.height * ratio,
    );
    context.fillStyle = "#fafbfc";
    context.font = "600 " + (portrait ? 58 : 46) + "px Inter, sans-serif";
    const titleLines = lines(context, vehicle.title, infoWidth, 3);
    titleLines.forEach((line, index) =>
      context.fillText(line, infoX, infoY + index * 64),
    );
    let y = infoY + titleLines.length * 64 + 26;
    context.fillStyle = "#bbc3ce";
    context.font = "400 " + (portrait ? 32 : 27) + "px Inter, sans-serif";
    const facts = [
      vehicle.mileage && vehicle.mileage + " miles",
      vehicle.stock && "Stock " + vehicle.stock,
      ...vehicle.highlights,
    ].filter(Boolean);
    for (const fact of facts) {
      for (const line of lines(context, fact, infoWidth, 1)) {
        context.fillText(line, infoX, y);
        y += portrait ? 48 : 46;
      }
    }
    if (vehicle.vin) {
      context.font = "400 22px Inter, sans-serif";
      context.fillText("VIN " + vehicle.vin, margin, canvas.height - 65);
    }
  };
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, {
    mimeType: encoding.mimeType,
    videoBitsPerSecond: 8000000,
  });
  const chunks: Blob[] = [];
  let failure: Error | null = null;
  const stopped = new Promise<void>((resolve) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => resolve();
    recorder.onerror = () => {
      failure = new Error(
        "The browser video encoder failed. Try again on another device.",
      );
      resolve();
    };
  });
  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  const hidden = () => {
    if (document.hidden) {
      failure = new Error(
        "Keep this screen open while exporting. Your saved spin is safe.",
      );
      stop();
    }
  };
  document.addEventListener("visibilitychange", hidden);
  options.signal.addEventListener("abort", stop, { once: true });
  try {
    for (let index = 0; index < frames.length; index++) {
      checkSpinAbort(options.signal);
      if (failure) throw failure;
      const bitmap = await createImageBitmap(frames[index]);
      try {
        draw(bitmap);
      } finally {
        bitmap.close();
      }
      if (index === 0) recorder.start(1000);
      await new Promise((resolve) => setTimeout(resolve, 8000 / frames.length));
      options.onProgress((index + 1) / frames.length);
    }
    stop();
    await stopped;
    checkSpinAbort(options.signal);
    if (failure) throw failure;
    const blob = new Blob(chunks, { type: encoding.mimeType.split(";")[0] });
    if (blob.size < 1000) throw new Error("The video export was empty. Please retry.");
    const name =
      vehicle.title
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "vehicle";
    return new File([blob], name + "-360." + encoding.extension, { type: blob.type });
  } finally {
    stop();
    stream.getTracks().forEach((track) => track.stop());
    document.removeEventListener("visibilitychange", hidden);
    options.signal.removeEventListener("abort", stop);
  }
};
