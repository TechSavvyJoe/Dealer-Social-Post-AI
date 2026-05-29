/**
 * Converts a data URL string into a Blob object.
 * This is useful for file operations, such as creating a File object for uploading or sharing.
 * @param dataUrl The data URL string (e.g., from a canvas or file reader).
 * @returns A Promise that resolves to a Blob.
 */
export const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
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
  // Modern browsers (Chrome 81+, Safari 15+, Firefox 98+) support createImageBitmap
  // with automatic orientation handling via imageOrientation option
  if (typeof createImageBitmap !== 'undefined') {
    try {
      // Create bitmap with automatic orientation correction
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image', // Respect EXIF orientation
      });
      
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close(); // Free memory
        
        // Use high quality for photos
        const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        return canvas.toDataURL(mimeType, 0.92);
      }
      bitmap.close();
    } catch (e) {
      console.warn('createImageBitmap failed, falling back to manual EXIF handling:', e);
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
 * Finds a direct image URL from an HTML string by looking for meta tags.
 * @param html The HTML content of a webpage.
 * @returns The found image URL or null.
 */
const findImageUrlInHtml = (html: string): string | null => {
  // Look for <meta property="og:image" content="URL">
  const ogImageMatch = html.match(
    /<meta\s+(?:name|property)="og:image"\s+content="([^"]+)"/
  );
  if (ogImageMatch && ogImageMatch[1]) {
    // Clean up potential tracking parameters
    return ogImageMatch[1].split("?")[0];
  }
  // Fallback to <link rel="image_src" href="URL">
  const imageSrcMatch = html.match(/<link\s+rel="image_src"\s+href="([^"]+)"/);
  if (imageSrcMatch && imageSrcMatch[1]) {
    return imageSrcMatch[1].split("?")[0];
  }
  return null;
};

/**
 * Fetches an image from a URL and converts it into a data URL string.
 * This is useful for using remote images with APIs that require base64 data.
 * It includes a special handler for Imgur page URLs to find the direct image link.
 * @param url The URL of the image to fetch.
 * @returns A Promise that resolves to the data URL string representation of the image.
 */
export const urlToDataUrl = async (url: string): Promise<string> => {
  try {
    let imageUrl = url;

    // If the URL is an Imgur page (e.g., imgur.com/a/xyz) instead of a direct image link (i.imgur.com/xyz.jpg),
    // we need to fetch the page's HTML and find the actual image URL.
    // Use our own secure local proxy instead of allorigins.win
    // This avoids leaking user IP to third parties and ensures consistent behavior
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;

    try {
      // Auth is the HttpOnly session cookie; credentials:"include" attaches it.
      const response = await fetch(proxyUrl, {
        credentials: "include",
      });
      if (response.ok) {
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
    } catch (e) {
      console.warn(
        "Local proxy failed, falling back to direct fetch (might fail CORS)",
        e
      );
    }

    // Fetch the final image URL (either the original or the one we resolved).
    // Direct image hosts like i.imgur.com usually have CORS headers that allow this fetch.
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Network response was not ok for URL: ${imageUrl}`);
    }
    const blob = await response.blob();

    // Verify that what we downloaded is actually an image file.
    if (!blob.type.startsWith("image/")) {
      throw new Error(
        `The link provided does not point to a direct image. Content type found: ${blob.type}. Please use a link ending in .jpg, .png, etc.`
      );
    }

    // Convert blob to data URL
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result as string);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error(
      `Error fetching URL to convert to data URL for '${url}':`,
      error
    );
    throw new Error(
      `Failed to load image from URL. Please check the link and your network connection.`
    );
  }
};
