
export const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return blob;
};

export const parseDataUrl = (dataUrl: string) => {
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) {
        throw new Error("Invalid data URL");
    }
    return { mimeType: match[1], data: match[2] };
};

export const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};
