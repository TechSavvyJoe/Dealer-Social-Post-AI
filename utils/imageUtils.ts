/**
 * Converts a data URL string into a Blob object.
 * This is useful for file operations, such as creating a File object for uploading or sharing.
 * @param dataUrl The data URL string (e.g., from a canvas or file reader).
 * @returns A Promise that resolves to a Blob.
 */
export const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  // Decode base64 data URLs directly so the Blob is created in the caller's
  // realm (browser or jsdom). Routing through fetch() yields a Blob from the
  // runtime's fetch implementation, which some environments (notably jsdom +
  // Node's global fetch) reject when it's later passed to FormData.append.
  const match = /^data:([^;,]*);base64,([\s\S]*)$/.exec(dataUrl);
  if (match) {
    const mime = match[1] || "application/octet-stream";
    const binary = atob(match[2].replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  // Non-base64 or remote URLs: fall back to fetch.
  const res = await fetch(dataUrl);
  return await res.blob();
};

/**
 * Parses a data URL to separate its MIME type and base64-encoded data.
 * This is required for sending image data to the Gemini API.
 * @param dataUrl The data URL string to parse.
 * @returns An object containing the MIME type and the base64 data.
 * @throws An error if the data URL format is invalid.
 */
export const parseDataUrl = (dataUrl: string) => {
  // [^;,]+ keeps the greedy MIME group from swallowing a second ";base64," in
  // the payload; [\s\S]+ tolerates newlines in the body (fetch-derived or
  // line-wrapped data URLs) that the $-anchored `.+` previously rejected.
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) {
    throw new Error("Invalid data URL");
  }
  return { mimeType: match[1], data: match[2].replace(/\s/g, "") };
};

/** Return a safe filename extension that matches an image source's format. */
export const imageFileExtension = (source: string): string => {
  const dataMime = source.match(/^data:image\/(png|jpe?g|webp|avif);/i)?.[1];
  if (dataMime) return dataMime.toLowerCase() === "jpeg" ? "jpg" : dataMime;

  try {
    const pathname = new URL(source, "https://local.invalid").pathname;
    const extension = pathname.match(/\.(png|jpe?g|webp|avif)$/i)?.[1];
    if (extension) {
      return extension.toLowerCase() === "jpeg" ? "jpg" : extension.toLowerCase();
    }
  } catch {
    /* fall through to the interoperable photo default */
  }

  return "jpg";
};

/**
 * Reads a File object and converts it into a data URL string.
 * This is useful for displaying a local preview of a user-selected image before processing.
 * @param file The File object, typically from a file input or drag-and-drop event.
 * @returns A Promise that resolves to the data URL string representation of the file.
 */
export const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Veo only accepts 16:9 or 9:16. Pad the source with letterbox (contain) so the
 * model is not forced to invent vertical/horizontal pixels by cropping/zooming.
 * Returns the original data URL unchanged if canvas is unavailable or the
 * source already matches the target aspect within a small tolerance.
 */
export const letterboxImageForVideo = async (
  dataUrl: string,
  aspect: "16:9" | "9:16",
  longEdge = 1280,
): Promise<string> => {
  if (typeof document === "undefined") return dataUrl;

  const targetRatio = aspect === "16:9" ? 16 / 9 : 9 / 16;
  const outW = aspect === "16:9" ? longEdge : Math.round(longEdge * (9 / 16));
  const outH = aspect === "16:9" ? Math.round(longEdge * (9 / 16)) : longEdge;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not load image for letterbox."));
    el.src = dataUrl;
  });

  const srcRatio = img.width / Math.max(img.height, 1);
  if (Math.abs(srcRatio - targetRatio) < 0.04) {
    return dataUrl;
  }

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  // Soft dark pad — premium social letterbox, not pure black cutout
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, outW, outH);

  const scale = Math.min(outW / img.width, outH / img.height);
  const dw = Math.round(img.width * scale);
  const dh = Math.round(img.height * scale);
  const dx = Math.round((outW - dw) / 2);
  const dy = Math.round((outH - dh) / 2);
  ctx.drawImage(img, dx, dy, dw, dh);

  try {
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return dataUrl;
  }
};

/**
 * Pick Veo aspect from source dimensions. Social-first: portrait → 9:16,
 * landscape → 16:9, square → 9:16 (Stories/Reels) after letterbox.
 */
export const resolveVeoAspect = (
  width: number,
  height: number,
  preference: "auto" | "16:9" | "9:16" | "1:1",
): "16:9" | "9:16" => {
  if (preference === "16:9" || preference === "1:1") return "16:9";
  if (preference === "9:16") return "9:16";
  if (height > width * 1.08) return "9:16";
  if (width > height * 1.08) return "16:9";
  return "9:16";
};

/**
 * Detects the EXIF orientation value (1-8) from a JPEG file.
 * Returns 1 if orientation can't be determined or file isn't a JPEG.
 */
export const getJpegExifOrientation = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    if (file.type !== "image/jpeg") {
      resolve(1);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const view = new DataView(reader.result as ArrayBuffer);
      // JPEG starts with 0xFFD8
      if (view.getUint16(0, false) !== 0xffd8) {
        resolve(1);
        return;
      }
      let offset = 2;
      const length = view.byteLength;
      while (offset < length) {
        const marker = view.getUint16(offset, false);
        offset += 2;
        if (marker === 0xffe1) {
          // APP1
          const segmentLength = view.getUint16(offset, false);
          offset += 2;
          // Check for Exif header ("Exif\0\0")
          if (
            view.getUint32(offset, false) === 0x45786966 && // 'Exif'
            view.getUint16(offset + 4, false) === 0x0000
          ) {
            let tiffOffset = offset + 6;
            const endianness = view.getUint16(tiffOffset, false);
            const littleEndian = endianness === 0x4949; // 'II'
            if (!littleEndian && endianness !== 0x4d4d) {
              // 'MM'
              resolve(1);
              return;
            }
            // Validate TIFF magic number 0x002A
            if (view.getUint16(tiffOffset + 2, littleEndian) !== 0x002a) {
              resolve(1);
              return;
            }
            const firstIFDOffset = view.getUint32(tiffOffset + 4, littleEndian);
            let ifdOffset = tiffOffset + firstIFDOffset;
            const entries = view.getUint16(ifdOffset, littleEndian);
            for (let i = 0; i < entries; i++) {
              const entryOffset = ifdOffset + 2 + i * 12;
              const tag = view.getUint16(entryOffset, littleEndian);
              if (tag === 0x0112) {
                // Orientation tag
                const valueOffset = entryOffset + 8;
                const orientation = view.getUint16(valueOffset, littleEndian);
                resolve(orientation);
                return;
              }
            }
            resolve(1);
            return;
          }
        } else if ((marker & 0xff00) !== 0xff00) {
          // Invalid marker
          break;
        } else {
          // Skip segment
          const segmentLength = view.getUint16(offset, false);
          offset += segmentLength;
        }
      }
      resolve(1);
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Generates a new oriented (and EXIF metadata stripped) data URL from an image File.
 * For JPEG files, applies EXIF orientation. For other formats, uses createImageBitmap
 * which automatically handles orientation in modern browsers.
 *
 * This ensures photos taken in portrait/landscape are displayed correctly regardless
 * of how the camera saved them.
 */
export const fileToNormalizedDataUrl = async (file: File): Promise<string> => {
  const maxDimension = 2048;

  // Modern browsers (Chrome 81+, Safari 15+, Firefox 98+) support createImageBitmap
  // with automatic orientation handling via imageOrientation option
  if (typeof createImageBitmap !== "undefined") {
    try {
      // Create bitmap with automatic orientation correction
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image", // Respect EXIF orientation
      });

      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const outputWidth = Math.max(1, Math.round(bitmap.width * scale));
      const outputHeight = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, outputWidth, outputHeight);
        bitmap.close(); // Free memory

        // Use high quality for photos
        const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
        return canvas.toDataURL(mimeType, 0.92);
      }
      bitmap.close();
    } catch (e) {
      console.warn(
        "createImageBitmap failed, falling back to manual EXIF handling:",
        e,
      );
    }
  }

  // Fallback for older browsers: manual EXIF orientation handling
  const originalDataUrl = await fileToDataUrl(file);
  let orientation = 1;
  try {
    orientation = await getJpegExifOrientation(file);
  } catch {
    orientation = 1;
  }

  // If orientation is 1 and not JPEG, just return original
  if (orientation === 1 && file.type !== "image/jpeg") {
    return originalDataUrl;
  }

  // Load image into canvas and apply transforms
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = originalDataUrl;
  });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return originalDataUrl;
  }

  const { width, height } = img;

  // Set canvas size depending on rotation
  if (orientation > 4 && orientation < 9) {
    canvas.width = height;
    canvas.height = width;
  } else {
    canvas.width = width;
    canvas.height = height;
  }

  // Apply orientation transforms
  switch (orientation) {
    case 2: // Flip horizontal
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      break;
    case 3: // Rotate 180
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 4: // Flip vertical
      ctx.translate(0, height);
      ctx.scale(1, -1);
      break;
    case 5: // Transpose
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      ctx.translate(0, -height);
      break;
    case 6: // Rotate 90 CW
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -height);
      break;
    case 7: // Transverse
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(width, -height);
      ctx.scale(-1, 1);
      break;
    case 8: // Rotate 270 CW
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-width, 0);
      break;
    default:
      break;
  }

  ctx.drawImage(img, 0, 0);
  const mimeType = file.type === "image/jpeg" ? "image/jpeg" : file.type;
  return canvas.toDataURL(mimeType, 0.92);
};

/**
 * Fetches an image from a URL and converts it into a data URL string.
 * Remote content always travels through the authenticated, allowlisted image
 * proxy so arbitrary origins never receive the browser user's IP address.
 * @param url The URL of the image to fetch.
 * @returns A Promise that resolves to the data URL string representation of the image.
 */
export const urlToDataUrl = async (url: string): Promise<string> => {
  try {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl, { credentials: "include" });

    if (!response.ok) {
      throw new Error(`Image proxy rejected the request (${response.status}).`);
    }
    const blob = await response.blob();

    if (!blob.type.startsWith("image/")) {
      throw new Error("The remote resource is not a supported image.");
    }

    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read remote image."));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    // Never log the URL itself: an operator may use a signed image URL whose
    // query string is a credential.
    console.error("Remote image conversion failed.", error);
    throw new Error(
      "Failed to load image from URL. Check that it is a trusted HTTPS image host and try again.",
    );
  }
};
