import React, { useState } from 'react';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';

interface EditTextModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
  originalText: string;
  isLoading: boolean;
}

export const EditTextModal: React.FC<EditTextModalProps> = ({ isOpen, onClose, onSubmit, originalText, isLoading }) => {
  const [prompt, setPrompt] = useState('');

  if (!isOpen) {
    return null;
  }

  const handleSubmit = () => {
    triggerHapticFeedback();
    if (prompt.trim() && !isLoading) {
      onSubmit(prompt);
    }
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

  return (
    <div 
        className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-opacity duration-300 animate-fade-in"
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-text-title"
    >
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-lg border border-white/20 flex flex-col gap-6">
        <div className="flex items-center justify-between">
            <h2 id="edit-text-title" className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
                <Icon type="edit" className="w-6 h-6 text-indigo-400"/>
                <span>Edit Post Text with AI</span>
            </h2>
             <button onClick={handleClose} aria-label="Close" className="text-slate-400 text-3xl leading-none hover:text-white">&times;</button>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Original Text
          </label>
          <div className="w-full bg-slate-800/50 text-slate-400 border border-white/10 rounded-md px-4 py-3 text-sm max-h-24 overflow-y-auto">
            {originalText.split('\n').map((line, i) => <span key={i}>{line}<br/></span>)}
          </div>
        </div>
        
        <div>
           <label htmlFor="editPrompt" className="block text-sm font-medium text-slate-300 mb-2">
            How would you like to change it?
          </label>
          <textarea
            id="editPrompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Make it funnier, or add a question at the end..."
            className="w-full bg-slate-800/50 text-white border-2 border-white/20 rounded-md px-4 py-3 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition h-24 resize-none"
          />
        </div>
        
        <div className="mt-2 flex justify-end gap-3">
          <button 
            onClick={handleClose}
            className="bg-white/10 border border-white/20 text-white font-bold py-2 px-4 rounded-lg hover:bg-white/20 transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit}
            disabled={!prompt.trim() || isLoading}
            className="w-40 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold py-2 px-4 rounded-lg hover:scale-105 transition-transform duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {isLoading ? (
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            ) : (
                "Submit Edit"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
