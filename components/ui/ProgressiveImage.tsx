import React from "react";
import { cn } from "../../utils/classNames";

interface ProgressiveImageProps {
  src: string;
  alt: string;
  placeholderSrc?: string;
  className?: string;
  onLoad?: () => void;
}

/**
 * Progressive image loading component
 * Loads low-res placeholder first, then high-res image
 */
export const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  src,
  alt,
  placeholderSrc,
  className,
  onLoad,
}) => {
  const [imageSrc, setImageSrc] = React.useState(placeholderSrc || src);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    // Guard against setState-after-unmount and out-of-order resolution when
    // `src` changes mid-load (a slow earlier load must not overwrite a newer
    // src). `ignored` is flipped in cleanup and the handlers are detached.
    let ignored = false;
    const img = new Image();

    img.onload = () => {
      if (ignored) return;
      setImageSrc(src);
      setIsLoading(false);
      onLoad?.();
    };

    img.onerror = () => {
      if (ignored) return;
      setIsLoading(false);
    };

    setIsLoading(true);
    img.src = src;

    return () => {
      ignored = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [src, onLoad]);

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={cn(
        "transition-opacity duration-180",
        isLoading ? "opacity-50 blur-xs" : "opacity-100",
        className,
      )}
      loading="lazy"
    />
  );
};
