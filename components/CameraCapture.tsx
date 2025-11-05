import React, { useState, useRef } from 'react';
import { Icon } from './Icons';
import { fileToDataUrl } from '../utils/imageUtils';
import { WebcamCapture } from './WebcamCapture';
import { triggerHapticFeedback } from '../utils/haptics';

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
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
    event.target.value = "";
  };

  const processFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError("Invalid file type. Please use an image file.");
      return;
    }
    try {
      setError(null);
      const dataUrl = await fileToDataUrl(file);
      onImageSelected(dataUrl);
    } catch (err) {
      console.error("Error reading file:", err);
      setError("Could not read the selected image file. Please try again.");
    }
  };
  
  const handleOpenCamera = () => {
    triggerHapticFeedback();
    if (isMobileDevice()) {
        cameraInputRef.current?.click();
    } else {
        setShowWebcam(true);
    }
  };

  const handleUploadPhoto = () => {
    triggerHapticFeedback();
    fileInputRef.current?.click();
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.items && event.dataTransfer.items.length > 0) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);

    const file = event.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };
  
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
      <WebcamCapture
        onImageSelected={(imageSrc) => {
          setShowWebcam(false);
          onImageSelected(imageSrc);
        }}
        onClose={() => setShowWebcam(false)}
      />
    );
  }

  return (
    <div 
      className={`relative w-full max-w-2xl mx-auto p-2 sm:p-4 bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/20 transition-all duration-300 ${
        isDraggingOver ? 'border-indigo-400 scale-105' : 'border-white/20'
      }`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
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
        />
        <input
          type="file"
          ref={cameraInputRef}
          onChange={handleFileChange}
          accept="image/*"
          capture="environment"
          className="hidden"
        />
        
          <div className="text-center py-4 sm:py-8">
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">Add a Photo</h2>
              <p className="text-indigo-300 mb-6 sm:mb-8 text-sm sm:text-base">Capture a moment, upload a file, or drag & drop.</p>
              <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
                  <button onClick={handleOpenCamera} className="w-full sm:w-auto flex items-center justify-center gap-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold py-3 px-6 rounded-full hover:scale-105 transition-all duration-300 shadow-lg">
                      <Icon type="camera" className="w-6 sm:w-7 h-6 sm:h-7"/>
                      <span className="text-base sm:text-lg">Open Camera</span>
                  </button>
                   <button onClick={handleUploadPhoto} className="w-full sm:w-auto flex items-center justify-center gap-3 bg-white/10 border border-white/20 text-white font-bold py-3 px-6 rounded-full hover:bg-white/20 hover:scale-105 transition-all duration-300 shadow-lg">
                      <Icon type="upload" className="w-6 sm:w-7 h-6 sm:h-7"/>
                      <span className="text-base sm:text-lg">Upload Photo</span>
                  </button>
              </div>
          </div>
      </div>
    </div>
  );
};