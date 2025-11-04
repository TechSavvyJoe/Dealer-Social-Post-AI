import React, { useState, useEffect, useRef } from 'react';
import { DealershipSettings } from '../types';
import { Icon } from './Icons';
import { fileToDataUrl } from '../utils/imageUtils';
import { triggerHapticFeedback } from '../utils/haptics';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: DealershipSettings) => void;
  currentSettings: DealershipSettings;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSave, currentSettings }) => {
  const [dealershipName, setDealershipName] = useState(currentSettings.dealershipName);
  const [logo, setLogo] = useState(currentSettings.dealershipLogo);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDealershipName(currentSettings.dealershipName);
    setLogo(currentSettings.dealershipLogo);
  }, [currentSettings]);

  if (!isOpen) {
    return null;
  }

  const handleSave = () => {
    triggerHapticFeedback();
    onSave({ dealershipName, dealershipLogo: logo });
  };
  
  const handleClose = () => {
    triggerHapticFeedback();
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
          handleClose();
      }
  }

  const processLogoFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert("Invalid file type. Please use a PNG or JPG file.");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setLogo(dataUrl);
    } catch (err) {
      console.error("Error reading logo file:", err);
      alert("Could not read the selected logo file. Please try again.");
    }
  };

  const handleLogoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await processLogoFile(file);
    }
    event.target.value = "";
  };
  
  const handleUploadClick = () => {
    triggerHapticFeedback();
    fileInputRef.current?.click();
  }
  
  const handleRemoveLogo = () => {
    triggerHapticFeedback();
    setLogo(undefined);
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); };
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); };
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) {
        await processLogoFile(file);
      }
  };

  return (
    <div 
        className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-opacity duration-300"
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
    >
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8 w-full max-w-md border border-white/20 flex flex-col gap-6">
        <div className="flex items-center justify-between">
            <h2 id="settings-title" className="text-2xl font-bold text-white flex items-center gap-2">
                <Icon type="settings" className="w-6 h-6 text-indigo-400"/>
                <span>App Settings</span>
            </h2>
             <button onClick={handleClose} aria-label="Close settings" className="text-slate-400 text-3xl leading-none hover:text-white">&times;</button>
        </div>
        
        <div>
          <label htmlFor="dealershipName" className="block text-sm font-medium text-slate-300 mb-2">
            Dealership Name
          </label>
          <input
            type="text"
            id="dealershipName"
            value={dealershipName}
            onChange={(e) => setDealershipName(e.target.value)}
            placeholder="e.g., Prestige Auto"
            className="w-full bg-slate-800/50 text-white border-2 border-white/20 rounded-md px-4 py-3 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition"
          />
          <p className="text-xs text-slate-500 mt-2">This name will appear on generated images and in post text.</p>
        </div>

        <div>
           <label className="block text-sm font-medium text-slate-300 mb-2">
            Dealership Logo
          </label>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleLogoChange}
            accept="image/png, image/jpeg"
            className="hidden"
          />
          {logo ? (
            <div className="flex items-center gap-4">
                <img src={logo} alt="Logo Preview" className="w-16 h-16 object-contain rounded-md bg-slate-800/50 p-1 border-2 border-white/20" />
                <button onClick={handleRemoveLogo} className="bg-red-600/50 border border-red-500 text-white font-bold py-2 px-3 rounded-lg hover:bg-red-600/70 text-sm transition-colors">
                    Remove
                </button>
            </div>
          ) : (
            <div 
                className={`w-full bg-white/5 border-2 border-dashed rounded-lg hover:bg-white/10 hover:border-white/30 transition-all duration-300 ${isDraggingOver ? 'border-indigo-400 scale-105' : 'border-white/20'}`}
                onDrop={handleDrop} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}
            >
                <button onClick={handleUploadClick} className="w-full py-3 px-4 flex items-center justify-center gap-2 text-white font-bold">
                    <Icon type="upload" className="w-5 h-5"/>
                    <span>{isDraggingOver ? 'Drop to Upload' : 'Upload or Drag Logo'}</span>
                </button>
            </div>
          )}
           <p className="text-xs text-slate-500 mt-2">Optional. Replaces the text watermark with your logo.</p>
        </div>
        
        <div className="mt-2 flex justify-end gap-3">
          <button 
            onClick={handleClose}
            className="bg-white/10 border border-white/20 text-white font-bold py-2 px-4 rounded-lg hover:bg-white/20 transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold py-2 px-4 rounded-lg hover:scale-105 transition-transform duration-300"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};