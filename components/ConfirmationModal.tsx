import React from 'react';
import { triggerHapticFeedback } from '../utils/haptics';
import { Icon } from './Icons';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  itemName: string;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, onClose, onConfirm, itemName }) => {
  if (!isOpen) return null;

  const handleConfirm = () => {
    triggerHapticFeedback();
    onConfirm();
  };
  
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-lg flex items-center justify-center z-50 p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-slate-800/80 border border-white/20 rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-900/50">
                <Icon type="error" className="h-6 w-6 text-red-400" />
            </div>
            <h3 className="mt-5 text-lg font-medium leading-6 text-white">Delete "{itemName}"?</h3>
            <div className="mt-2 px-7 pb-4">
                <p className="text-sm text-slate-400">
                    Are you sure? This action cannot be undone.
                </p>
            </div>
        </div>
        <div className="mt-5 flex justify-center gap-4">
          <button onClick={onClose} className="w-full bg-white/10 border border-white/20 text-white font-bold py-2 px-6 rounded-lg hover:bg-white/20 transition-colors">Cancel</button>
          <button onClick={handleConfirm} className="w-full bg-red-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-red-500 transition-colors">Delete</button>
        </div>
      </div>
    </div>
  );
};
