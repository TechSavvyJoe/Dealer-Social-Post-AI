import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { triggerHapticFeedback } from '../utils/haptics';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: User) => void;
  user: User | null;
  dealerId: string | null;
}

export const UserModal: React.FC<UserModalProps> = ({ isOpen, onClose, onSave, user, dealerId }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.id);
    } else {
      setName('');
      setPhone('');
    }
    setError('');
  }, [user, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    triggerHapticFeedback();
    if (!name.trim()) {
      setError('User name is required.');
      return;
    }
    const numericPhone = phone.replace(/\D/g, '');
    if (numericPhone.length !== 10) {
      setError('Phone number must be exactly 10 digits.');
      return;
    }
    if (!dealerId) {
        setError('Cannot save user without a dealer ID.');
        return;
    }
    onSave({ name: name.trim(), id: numericPhone, dealerId: user?.dealerId || dealerId });
  };
  
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-lg flex items-center justify-center z-50 p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-slate-800/80 border border-white/20 rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-bold text-white mb-6">{user ? 'Edit User' : 'Add New User'}</h2>
        {error && <p className="text-red-400 bg-red-900/50 p-2 rounded-md mb-4 text-sm">{error}</p>}
        <div className="space-y-4">
          <div>
            <label htmlFor="user-name" className="block text-sm font-medium text-slate-300 mb-2">User Name</label>
            <input id="user-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-slate-900/50 text-white border-2 border-white/20 rounded-md px-4 py-2 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition" />
          </div>
          <div>
            <label htmlFor="user-phone" className="block text-sm font-medium text-slate-300 mb-2">Phone Number</label>
            <input id="user-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} disabled={!!user} placeholder="10 digits, e.g., 5551234567" className="w-full bg-slate-900/50 text-white border-2 border-white/20 rounded-md px-4 py-2 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition disabled:opacity-50" />
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
