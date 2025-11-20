import React, { useState, useRef, useEffect } from 'react';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';

interface ImageCropModalProps {
    isOpen: boolean;
    imageSrc: string;
    onConfirm: (croppedImage: string) => void;
    onCancel: () => void;
}

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
    isOpen,
    imageSrc,
    onConfirm,
    onCancel,
}) => {
    const [zoom, setZoom] = useState(100);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'auto';
        }
        return () => {
            document.body.style.overflow = 'auto';
        };
    }, [isOpen]);

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging) {
            setPosition({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y,
            });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleReset = () => {
        triggerHapticFeedback();
        setZoom(100);
        setPosition({ x: 0, y: 0 });
    };

    const handleConfirm = async () => {
        triggerHapticFeedback();

        // Create a canvas to capture the cropped image
        const canvas = canvasRef.current;
        const image = imageRef.current;
        const container = containerRef.current;

        if (!canvas || !image || !container) {
            onConfirm(imageSrc);
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            onConfirm(imageSrc);
            return;
        }

        // Set canvas size to match container
        const containerRect = container.getBoundingClientRect();
        canvas.width = containerRect.width;
        canvas.height = containerRect.height;

        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Calculate image dimensions with zoom
        const scale = zoom / 100;
        const imgWidth = image.naturalWidth * scale;
        const imgHeight = image.naturalHeight * scale;

        // Draw image with current transform
        ctx.drawImage(
            image,
            position.x + (canvas.width - imgWidth) / 2,
            position.y + (canvas.height - imgHeight) / 2,
            imgWidth,
            imgHeight
        );

        // Convert to data URL
        const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.92);
        onConfirm(croppedDataUrl);
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={onCancel}
        >
            <div
                className="w-full max-w-4xl bg-surface-900 rounded-2xl shadow-2xl border border-white/10 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-white">Preview & Adjust Image</h2>
                    <button
                        onClick={onCancel}
                        className="text-white/60 hover:text-white transition-colors"
                        aria-label="Close"
                    >
                        <Icon type="close" className="w-6 h-6" />
                    </button>
                </div>

                {/* Image Preview Area */}
                <div
                    ref={containerRef}
                    className="relative w-full h-[60vh] bg-black overflow-hidden cursor-move"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                >
                    <img
                        ref={imageRef}
                        src={imageSrc}
                        alt="Preview"
                        className="absolute select-none pointer-events-none"
                        style={{
                            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom / 100})`,
                            transformOrigin: 'center',
                            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                            left: '50%',
                            top: '50%',
                            marginLeft: '-50%',
                            marginTop: '-50%',
                            maxWidth: 'none',
                            maxHeight: 'none',
                        }}
                    />

                    {/* Hint */}
                    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/60 px-4 py-2 rounded-lg text-white/80 text-sm pointer-events-none">
                        Drag to reposition • Use slider to zoom
                    </div>
                </div>

                {/* Controls */}
                <div className="px-6 py-4 bg-surface-800/50 border-t border-white/10">
                    <div className="flex items-center gap-4 mb-4">
                        <label className="text-sm text-white/80 font-medium min-w-[60px]">
                            Zoom: {zoom}%
                        </label>
                        <input
                            type="range"
                            min="50"
                            max="200"
                            value={zoom}
                            onChange={(e) => setZoom(Number(e.target.value))}
                            className="flex-1 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary-500 
                [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg"
                        />
                        <button
                            onClick={handleReset}
                            className="px-3 py-1.5 text-sm rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                        >
                            Reset
                        </button>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 justify-end">
                        <button
                            onClick={onCancel}
                            className="px-6 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            className="px-6 py-2.5 rounded-full bg-primary-500 hover:bg-primary-400 text-white font-semibold shadow-lg transition-colors"
                        >
                            Use This Image
                        </button>
                    </div>
                </div>

                {/* Hidden canvas for cropping */}
                <canvas ref={canvasRef} className="hidden" />
            </div>
        </div>
    );
};
