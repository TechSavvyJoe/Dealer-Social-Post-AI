import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Icon } from './Icons';
import { fileToNormalizedDataUrl } from '../utils/imageUtils';
import { WebcamCapture } from './WebcamCapture';
import { triggerHapticFeedback } from '../utils/haptics';
import { ImagePreviewModal } from './ImagePreviewModal';

interface ImageInputProps {
  onImageSelected: (imageSrc: string) => void;
  onClose: () => void;
}

const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};


export const ImageInput: React.FC<ImageInputProps> = ({ onImageSelected }) => {
  const [error, setError] = useState<string | null>(null);
  const [showWebcam, setShowWebcam] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraEnvInputRef = useRef<HTMLInputElement>(null);
  const cameraUserInputRef = useRef<HTMLInputElement>(null);
  const [captureFacing, setCaptureFacing] = useState<'environment' | 'user'>('environment');
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<'upload' | 'camera-mobile' | 'camera-webcam' | null>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const source: 'upload' | 'camera-mobile' = (event.target === cameraEnvInputRef.current || event.target === cameraUserInputRef.current) ? 'camera-mobile' : 'upload';
      processFile(file, source);
    }
    event.target.value = "";
  };

  const processFile = useCallback(async (file: File, source: 'upload' | 'camera-mobile') => {
    console.log('[DEBUG] processFile called with:', { fileName: file.name, fileType: file.type, source });
    if (!file.type.startsWith('image/')) {
      setError("Invalid file type. Please use an image file.");
      return;
    }
    try {
      setError(null);
      console.log('[DEBUG] About to process image file...');
      const dataUrl = await fileToNormalizedDataUrl(file);
      console.log('[DEBUG] dataUrl generated, length:', dataUrl.length);
      // Show preview first; confirm before committing upstream
      setPendingImage(dataUrl);
      setLastSource(source);
      console.log('[DEBUG] pendingImage and lastSource set');
    } catch (err) {
      console.error("Error reading file:", err);
      setError("Could not read the selected image file. Please try again.");
    }
  }, []);

  const handleOpenCamera = () => {
    triggerHapticFeedback();
    if (isMobileDevice()) {
      if (captureFacing === 'environment' && cameraEnvInputRef.current) {
        cameraEnvInputRef.current.setAttribute('capture', 'environment');
        cameraEnvInputRef.current.click();
      } else if (captureFacing === 'user' && cameraUserInputRef.current) {
        cameraUserInputRef.current.setAttribute('capture', 'user');
        cameraUserInputRef.current.click();
      }
    } else {
      setShowWebcam(true);
    }
  };

  const handleUploadPhoto = () => {
    triggerHapticFeedback();
    fileInputRef.current?.click();
  }

  useEffect(() => {
    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(true);
    };

    const handleWindowDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        setIsDraggingOver(true);
      }
    };

    const handleWindowDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Only disable if we are leaving the window (clientX/Y are 0 or outside bounds)
      // or if relatedTarget is null (meaning we left the document)
      if (e.clientX === 0 || e.clientY === 0) {
        setIsDraggingOver(false);
      }
    };

    const handleWindowDrop = (e: DragEvent) => {
      console.log('[DEBUG] handleWindowDrop triggered');
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);

      const file = e.dataTransfer?.files?.[0];
      console.log('[DEBUG] File from drop:', file);
      if (file) {
        console.log('[DEBUG] Calling processFile...');
        processFile(file, 'upload');
      }
    };

    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [processFile]);

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-red-900/50 border border-red-700 text-red-300 p-8 text-center rounded-2xl">
        <Icon type="error" className="w-16 h-16 text-red-400 mb-4" />
        <p className="text-red-300 text-lg">{error}</p>
        <button onClick={() => { triggerHapticFeedback(); setError(null); }} className="mt-6 bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-500 transition-colors">
          Try Again
        </button>
      </div>
    );
  }

  if (showWebcam) {
    return (
      <>
        <WebcamCapture
          onImageSelected={(imageSrc) => {
            setShowWebcam(false);
            setPendingImage(imageSrc);
            setLastSource('camera-webcam');
          }}
          onClose={() => setShowWebcam(false)}
        />
        <ImagePreviewModal
          isOpen={Boolean(pendingImage)}
          imageSrc={pendingImage || ''}
          onClose={() => { setPendingImage(null); setLastSource(null); }}
          onConfirm={() => {
            if (pendingImage) {
              onImageSelected(pendingImage);
              setPendingImage(null);
              setLastSource(null);
            }
          }}
          confirmLabel="Use Photo"
          onRetake={() => {
            if (lastSource === 'camera-webcam') {
              setPendingImage(null);
              setShowWebcam(true);
            } else if (lastSource === 'camera-mobile') {
              setPendingImage(null);
              handleOpenCamera();
            } else if (lastSource === 'upload') {
              setPendingImage(null);
              fileInputRef.current?.click();
            } else {
              setPendingImage(null);
            }
          }}
        />
      </>
    );
  }

  return (
    <>
      <div
        className={`relative w-full max-w-2xl mx-auto p-2 sm:p-4 bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/20 transition-all duration-300 ${isDraggingOver ? 'border-indigo-400 scale-105' : 'border-white/20'
          }`}
      >
        {isDraggingOver && (
          <div className="absolute inset-0 bg-indigo-600/50 rounded-2xl flex items-center justify-center pointer-events-none z-10">
            <div className="text-center">
              <Icon type="upload" className="w-16 h-16 text-white mx-auto animate-bounce" />
              <p className="mt-2 text-2xl font-bold text-white">Drop Image Here</p>
            </div>
          </div>
        )}
        <div className="relative border-2 border-dashed border-white/20 rounded-xl p-4 sm:p-8 transition-colors duration-300">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
            aria-label="Upload image file"
          />
          {/* Native camera - environment (rear) */}
          <input
            type="file"
            ref={cameraEnvInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
            aria-label="Open rear camera"
          />
          {/* Native camera - user (front) */}
          <input
            type="file"
            ref={cameraUserInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
            aria-label="Open front camera"
          />

          <div className="text-center py-4 sm:py-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">Add a Photo</h2>
            <p className="text-indigo-300 mb-6 sm:mb-8 text-sm sm:text-base">Capture a moment, upload a file, or drag & drop.</p>
            <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
              {/* Facing selection */}
              <div className="flex items-center gap-2 bg-white/5 border border-white/15 rounded-full px-2 py-1">
                <button
                  type="button"
                  onClick={() => { triggerHapticFeedback(); setCaptureFacing('environment'); }}
                  className={`px-3 py-1 rounded-full text-sm ${captureFacing === 'environment' ? 'bg-white/20 text-white' : 'text-white/80 hover:text-white'}`}
                  aria-label="Use rear camera"
                >
                  Rear
                </button>
                <button
                  type="button"
                  onClick={() => { triggerHapticFeedback(); setCaptureFacing('user'); }}
                  className={`px-3 py-1 rounded-full text-sm ${captureFacing === 'user' ? 'bg-white/20 text-white' : 'text-white/80 hover:text-white'}`}
                  aria-label="Use front camera"
                >
                  Front
                </button>
              </div>
              <button onClick={handleOpenCamera} className="w-full sm:w-auto flex items-center justify-center gap-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold py-3 px-6 rounded-full hover:scale-105 transition-all duration-300 shadow-lg">
                <Icon type="camera" className="w-6 sm:w-7 h-6 sm:h-7" />
                <span className="text-base sm:text-lg">Open Camera</span>
              </button>
              <button onClick={handleUploadPhoto} className="w-full sm:w-auto flex items-center justify-center gap-3 bg-white/10 border border-white/20 text-white font-bold py-3 px-6 rounded-full hover:bg-white/20 hover:scale-105 transition-all duration-300 shadow-lg">
                <Icon type="upload" className="w-6 sm:w-7 h-6 sm:h-7" />
                <span className="text-base sm:text-lg">Upload Photo</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* Preview modal for mobile/native or upload flow */}
      <ImagePreviewModal
        isOpen={Boolean(pendingImage)}
        imageSrc={pendingImage || ''}
        onClose={() => { setPendingImage(null); setLastSource(null); }}
        onConfirm={() => {
          if (pendingImage) {
            onImageSelected(pendingImage);
            setPendingImage(null);
            setLastSource(null);
          }
        }}
        confirmLabel="Use Photo"
        onRetake={() => {
          if (lastSource === 'camera-webcam') {
            setPendingImage(null);
            setShowWebcam(true);
          } else if (lastSource === 'camera-mobile') {
            setPendingImage(null);
            handleOpenCamera();
          } else if (lastSource === 'upload') {
            setPendingImage(null);
            fileInputRef.current?.click();
          } else {
            setPendingImage(null);
          }
        }}
      />
    </>
  );
};