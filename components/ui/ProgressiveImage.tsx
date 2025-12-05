import React from 'react';
import { cn } from '../../utils/classNames';

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
    const img = new Image();
    img.src = src;
    
    img.onload = () => {
      setImageSrc(src);
      setIsLoading(false);
      onLoad?.();
    };

    img.onerror = () => {
      setIsLoading(false);
    };
  }, [src, onLoad]);

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={cn(
        'transition-opacity duration-300',
        isLoading ? 'opacity-50 blur-sm' : 'opacity-100',
        className
      )}
      loading="lazy"
    />
  );
};
