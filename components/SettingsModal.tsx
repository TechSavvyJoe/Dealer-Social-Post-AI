import React, { useState, useEffect, useRef } from 'react';
import { DealershipSettings } from '../types';
import { Icon } from './Icons';
import { fileToDataUrl } from '../utils/imageUtils';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: DealershipSettings) => void;
  currentSettings: DealershipSettings;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSave, currentSettings }) => {
  const [dealershipName, setDealershipName] = useState(currentSettings.dealershipName);
  const [logo, setLogo] = useState(currentSettings.dealershipLogo);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDealershipName(currentSettings.dealershipName);
    setLogo(currentSettings.dealershipLogo);
  }, [currentSettings]);

  if (!isOpen) {
    return null;
  }

  const handleSave = () => {
    onSave({ dealershipName, dealershipLogo: logo });
  };
  
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
          onClose();
      }
  }

  const handleLogoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
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
    }
    event.target.value = "";
  };
  
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  }
  
  const handleRemoveLogo = () => {
    setLogo(undefined);
  }

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
             <button onClick={onClose} aria-label="Close settings" className="text-slate-400 text-3xl leading-none hover:text-white">&times;</button>
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
            <button onClick={handleUploadClick} className="w-full bg-white/5 border-2 border-dashed border-white/20 text-white font-bold py-3 px-4 rounded-lg hover:bg-white/10 hover:border-white/30 transition-colors flex items-center justify-center gap-2">
                <Icon type="upload" className="w-5 h-5"/>
                <span>Upload Logo</span>
            </button>
          )}
           <p className="text-xs text-slate-500 mt-2">Optional. Replaces the text watermark with your logo.</p>
        </div>
        
        <div className="mt-2 flex justify-end gap-3">
          <button 
            onClick={onClose}
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