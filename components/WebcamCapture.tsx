import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

interface WebcamCaptureProps {
  onImageSelected: (imageSrc: string) => void;
  onClose: () => void;
}

type Orientation = 'portrait' | 'landscape';

export const WebcamCapture: React.FC<WebcamCaptureProps> = ({ onImageSelected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // Effect to detect and update screen orientation
  useEffect(() => {
    const getOrientation = (): Orientation => window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
    
    setOrientation(getOrientation());

    const handleOrientationChange = () => {
      setOrientation(getOrientation());
    };

    window.addEventListener('resize', handleOrientationChange);
    
    return () => {
      window.removeEventListener('resize', handleOrientationChange);
    };
  }, []);

  const cleanupCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Initialize the camera. Deliberately NOT keyed on `orientation`: a resize
  // (mobile keyboard, browser chrome show/hide, rotation) fires constantly and
  // would tear down + re-acquire the camera each time — leaking MediaStreams
  // (camera light stays on) and flickering the feed. Orientation only affects
  // the CSS aspect ratio and the best-effort resolution hint, read live below.
  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      cleanupCamera();

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Webcam access is not supported by your browser.');
        }

        const isPortrait = window.innerHeight > window.innerWidth;
        const idealWidth = isPortrait ? 1080 : 1920;
        const idealHeight = isPortrait ? 1920 : 1080;

        // More advanced constraints to get the best possible picture quality
        const constraints: MediaStreamConstraints = { 
            // FIX: Cast to 'any' to allow experimental properties 'focusMode', 'exposureMode', and 'whiteBalanceMode' 
            // which are not present in the default TypeScript DOM library definitions, thus avoiding type errors.
            video: { 
                width: { ideal: idealWidth }, 
                height: { ideal: idealHeight },
                facingMode,
                // Request advanced features for better quality.
                // Using 'advanced' makes them optional, preventing errors on unsupported devices.
                advanced: [
                  { focusMode: 'continuous' },
                  { exposureMode: 'continuous' },
                  { whiteBalanceMode: 'continuous' }
                ]
            } as any
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        // If the effect was torn down (unmount / flip camera) while the
        // permission prompt or acquisition was in flight, stop this orphaned
        // stream rather than leaking its tracks.
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Error accessing webcam:", err);
        let message = "Could not access the webcam.";
        if (err instanceof Error) {
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                message = "Webcam access was denied. Please enable it in your browser settings.";
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                message = "No webcam was found. Please ensure one is connected and enabled.";
            } else if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
                message = "Your camera does not support the required resolution or features. Please try a different device.";
            }
        }
        setError(message);
      }
    };
    
    startCamera();

    return () => {
      cancelled = true;
      cleanupCamera();
    };
  }, [cleanupCamera, facingMode]);

  const handleCapture = () => {
    triggerHapticFeedback();
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      // Guard against capturing before the first frame is available — otherwise
      // videoWidth/Height are 0 and we emit an empty 0x0 JPEG as a "photo".
      if (!video.videoWidth || !video.videoHeight) {
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        cleanupCamera();
        onImageSelected(dataUrl);
      }
    }
  };
  
  const handleClose = () => {
      triggerHapticFeedback();
      cleanupCamera();
      onClose();
  }

  if (error) {
    return (
      <Modal
        isOpen
        onClose={handleClose}
        title="Camera unavailable"
        description="We could not start the camera on this device."
        size="lg"
      >
        <div className="flex flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-error-500/30 bg-error-500/10">
            <Icon type="error" className="w-8 h-8 text-error-300" />
          </div>
          <p className="text-error-100 text-base leading-relaxed">{error}</p>
          <Button onClick={handleClose} className="mt-6">
            Go back
          </Button>
        </div>
      </Modal>
    );
  }

  // Determine aspect ratio for the container. Using Tailwind's arbitrary values feature for portrait.
  const aspectRatioClass = orientation === 'portrait' ? 'aspect-[9/16]' : 'aspect-video';

  return (
    <Modal
      isOpen
      onClose={handleClose}
      title="Take photo"
      description="Frame the vehicle and customer, then capture when ready."
      size="full"
      className="sm:max-w-4xl bg-surface-900 border-white/10"
    >
      <div className="space-y-5">
        <div className={`relative w-full ${aspectRatioClass} bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/10`}>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" aria-label="Live webcam feed" />
            <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
            {/* Flip camera button */}
            <Button
              type="button"
              onClick={() => { triggerHapticFeedback(); setFacingMode(prev => prev === 'environment' ? 'user' : 'environment'); }}
              variant="outline"
              size="icon"
              className="absolute top-3 left-3 border-white/15 bg-surface-950/60 text-surface-50 hover:bg-surface-900/80"
              aria-label="Flip camera"
            >
              <Icon type="restart" className="w-6 h-6" />
            </Button>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <Button onClick={handleClose} title="Go back" aria-label="Go back" variant="outline" size="icon">
              <Icon type="retake" className="w-6 h-6" />
            </Button>
            <button onClick={handleCapture} title="Take photo" aria-label="Take photo" className="w-20 h-20 p-1 rounded-full bg-white/80 hover:bg-white active:bg-white transition-all flex items-center justify-center shadow-lg shadow-black/30 transform active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900">
                <div className="w-full h-full rounded-full bg-white ring-4 ring-inset ring-surface-900"></div>
            </button>
            <div aria-hidden="true" />
        </div>
      </div>
    </Modal>
  );
};
