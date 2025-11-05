import React, { useState, useEffect } from 'react';
import { Dealer } from '../types';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';
import { fileToDataUrl } from '../utils/imageUtils';

interface DealerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (dealer: Dealer) => void;
  dealer: Dealer | null;
}

export const DealerModal: React.FC<DealerModalProps> = ({ isOpen, onClose, onSave, dealer }) => {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [logo, setLogo] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    if (dealer) {
      setName(dealer.name);
      setId(dealer.id);
      setLogo(dealer.logo);
    } else {
      setName('');
      setId('');
      setLogo(undefined);
    }
    setError('');
  }, [dealer, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    triggerHapticFeedback();
    if (!name.trim()) {
      setError('Dealer name is required.');
      return;
    }
    if (!/^\d{4}$/.test(id)) {
      setError('Dealer code must be exactly 4 digits.');
      return;
    }
    onSave({ name: name.trim(), id, logo });
  };
  
  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { // 2MB limit
        setError('Logo file size should not exceed 2MB.');
        return;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        setLogo(dataUrl);
        setError('');
      } catch (err) {
        setError('Failed to read logo file.');
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-lg flex items-center justify-center z-50 p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-slate-800/80 border border-white/20 rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-bold text-white mb-6">{dealer ? 'Edit Dealer' : 'Add New Dealer'}</h2>
        {error && <p className="text-red-400 bg-red-900/50 p-2 rounded-md mb-4 text-sm">{error}</p>}
        <div className="space-y-4">
          <div>
            <label htmlFor="dealer-name" className="block text-sm font-medium text-slate-300 mb-2">Dealer Name</label>
            <input id="dealer-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-slate-900/50 text-white border-2 border-white/20 rounded-md px-4 py-2 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition" />
          </div>
          <div>
            <label htmlFor="dealer-id" className="block text-sm font-medium text-slate-300 mb-2">4-Digit Code</label>
            <input id="dealer-id" type="text" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, '').slice(0, 4))} disabled={!!dealer} className="w-full bg-slate-900/50 text-white border-2 border-white/20 rounded-md px-4 py-2 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition disabled:opacity-50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Logo</label>
            <div className="flex items-center gap-4">
                {logo ? <img src={logo} alt="logo" className="w-16 h-16 rounded-md object-contain bg-white/10 p-1" /> : <div className="w-16 h-16 rounded-md bg-slate-900/50 flex items-center justify-center"><Icon type="building-office" className="w-8 h-8 text-slate-500" /></div> }
                <input type="file" accept="image/png, image/jpeg, image/webp" onChange={handleLogoChange} className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500" />
            </div>
             {logo && <button onClick={() => setLogo(undefined)} className="text-xs text-red-400 hover:underline mt-2">Remove logo</button>}
          </div>
        </div>
        <div className="mt-8 flex justify-end gap-4">
          <button onClick={onClose} className="bg-white/10 border border-white/20 text-white font-bold py-2 px-6 rounded-lg hover:bg-white/20 transition-colors">Cancel</button>
          <button onClick={handleSave} className="bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-500 transition-colors">Save</button>
        </div>
      </div>
    </div>
  );
};
