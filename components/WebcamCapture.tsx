import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';

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

  // Effect to initialize and restart the camera when orientation changes
  useEffect(() => {
    const startCamera = async () => {
      cleanupCamera();
      
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Webcam access is not supported by your browser.');
        }

        const isPortrait = orientation === 'portrait';
        const idealWidth = isPortrait ? 1080 : 1920;
        const idealHeight = isPortrait ? 1920 : 1080;

        // More advanced constraints to get the best possible picture quality
        const constraints: MediaStreamConstraints = { 
            // FIX: Cast to 'any' to allow experimental properties 'focusMode', 'exposureMode', and 'whiteBalanceMode' 
            // which are not present in the default TypeScript DOM library definitions, thus avoiding type errors.
            video: { 
                width: { ideal: idealWidth }, 
                height: { ideal: idealHeight },
                facingMode: 'environment',
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
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
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
      cleanupCamera();
    };
  }, [cleanupCamera, orientation]);

  const handleCapture = () => {
    triggerHapticFeedback();
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
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
      <div className="w-full max-w-2xl mx-auto p-8 flex flex-col items-center justify-center bg-red-900/50 border border-red-700 text-center rounded-2xl">
        <Icon type="error" className="w-16 h-16 text-red-400 mb-4" />
        <p className="text-red-300 text-lg">{error}</p>
        <button onClick={handleClose} className="mt-6 bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-500 transition-colors">
          Go Back
        </button>
      </div>
    );
  }

  // Determine aspect ratio for the container. Using Tailwind's arbitrary values feature for portrait.
  const aspectRatioClass = orientation === 'portrait' ? 'aspect-[9/16]' : 'aspect-video';

  return (
    <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="webcam-title">
        <h2 id="webcam-title" className="sr-only">Webcam Capture</h2>
        <div className={`relative w-full max-w-4xl ${aspectRatioClass} bg-black rounded-lg overflow-hidden shadow-2xl border-2 border-white/10`}>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" aria-label="Live webcam feed" />
            <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-center w-full max-w-4xl mt-6">
             <button onClick={handleClose} title="Go Back" aria-label="Go Back" className="absolute left-4 sm:left-auto text-slate-300 hover:text-white transition-colors p-3 rounded-full bg-black/30 hover:bg-black/50">
                <Icon type="retake" className="w-8 h-8" />
            </button>
            <button onClick={handleCapture} title="Take Photo" aria-label="Take Photo" className="w-20 h-20 p-1 rounded-full bg-white/50 hover:bg-white/75 active:bg-white transition-all flex items-center justify-center shadow-lg transform active:scale-95">
                <div className="w-full h-full rounded-full bg-white ring-4 ring-inset ring-slate-800"></div>
            </button>
        </div>
    </div>
  );
};
