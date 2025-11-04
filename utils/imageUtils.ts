

/**
 * Converts a data URL string into a Blob object.
 * This is useful for file operations, such as creating a File object for uploading or sharing.
 * @param dataUrl The data URL string (e.g., from a canvas or file reader).
 * @returns A Promise that resolves to a Blob.
 */
export const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return blob;
};

/**
 * Parses a data URL to separate its MIME type and base64-encoded data.
 * This is required for sending image data to the Gemini API.
 * @param dataUrl The data URL string to parse.
 * @returns An object containing the MIME type and the base64 data.
 * @throws An error if the data URL format is invalid.
 */
export const parseDataUrl = (dataUrl: string) => {
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) {
        throw new Error("Invalid data URL");
    }
    return { mimeType: match[1], data: match[2] };
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