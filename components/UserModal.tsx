import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { triggerHapticFeedback } from '../utils/haptics';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';

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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={user ? 'Edit user' : 'Add new user'}
      description="Salespeople are identified by their 10-digit phone number."
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSave}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && (
          <p className="rounded-xl border border-error-500/30 bg-error-500/10 px-3 py-2 text-sm text-error-200">
            {error}
          </p>
        )}

        <Input
          id="user-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="User name"
          fullWidth
        />

        <div>
          <Input
            id="user-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            disabled={!!user}
            maxLength={10}
            inputMode="numeric"
            placeholder="10-digit phone number"
            className="font-mono tracking-wider"
            fullWidth
          />
          <p className="mt-1.5 px-1 text-xs text-surface-400">
            {user
              ? 'Phone numbers cannot be changed after creation.'
              : 'Enter digits only, e.g. 5551234567.'}
          </p>
        </div>
      </div>
    </Modal>
  );
};
