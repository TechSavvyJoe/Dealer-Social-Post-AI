

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

/**
 * Finds a direct image URL from an HTML string by looking for meta tags.
 * @param html The HTML content of a webpage.
 * @returns The found image URL or null.
 */
const findImageUrlInHtml = (html: string): string | null => {
    // Look for <meta property="og:image" content="URL">
    const ogImageMatch = html.match(/<meta\s+(?:name|property)="og:image"\s+content="([^"]+)"/);
    if (ogImageMatch && ogImageMatch[1]) {
        // Clean up potential tracking parameters
        return ogImageMatch[1].split('?')[0];
    }
    // Fallback to <link rel="image_src" href="URL">
    const imageSrcMatch = html.match(/<link\s+rel="image_src"\s+href="([^"]+)"/);
    if (imageSrcMatch && imageSrcMatch[1]) {
        return imageSrcMatch[1].split('?')[0];
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
export const urlToDataUrl = (url: string): Promise<string> => {
  return new Promise(async (resolve, reject) => {
    try {
      let imageUrl = url;

      // If the URL is an Imgur page (e.g., imgur.com/a/xyz) instead of a direct image link (i.imgur.com/xyz.jpg),
      // we need to fetch the page's HTML and find the actual image URL.
      if (url.includes('imgur.com/') && !url.includes('i.imgur.com/')) {
        try {
          // Use a public CORS proxy to get around browser restrictions for fetching HTML from another domain.
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
          const pageResponse = await fetch(proxyUrl);
          
          if (pageResponse.ok) {
            const htmlText = await pageResponse.text();
            const directImageUrl = findImageUrlInHtml(htmlText);
            if (directImageUrl) {
              imageUrl = directImageUrl; // We found the direct link!
            }
          }
        } catch (proxyError) {
          // If the proxy fails, we'll just try the original URL and hope for the best.
          console.warn(`Could not resolve Imgur page via proxy for ${url}. Attempting direct fetch.`, proxyError);
        }
      }

      // Fetch the final image URL (either the original or the one we resolved).
      // Direct image hosts like i.imgur.com usually have CORS headers that allow this fetch.
      const response = await fetch(imageUrl);

      if (!response.ok) {
        throw new Error(`Network response was not ok for URL: ${imageUrl}`);
      }
      const blob = await response.blob();

      // Verify that what we downloaded is actually an image file.
      if (!blob.type.startsWith('image/')) {
        reject(new Error(`The link provided does not point to a direct image. Content type found: ${blob.type}. Please use a link ending in .jpg, .png, etc.`));
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result as string);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error(`Error fetching URL to convert to data URL for '${url}':`, error);
      reject(new Error(`Failed to load image from URL. Please check the link and your network connection.`));
    }
  });
};