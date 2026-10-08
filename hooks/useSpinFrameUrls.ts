import { useEffect, useState } from "react";
export const useSpinFrameUrls = (frames: Blob[]): string[] => {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = frames.map((frame) => URL.createObjectURL(frame));
    setUrls(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
  }, [frames]);
  return urls;
};
