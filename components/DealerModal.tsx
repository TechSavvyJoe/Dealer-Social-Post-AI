import React, { useState, useEffect } from 'react';
import { Dealer } from '../types';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';
import { fileToDataUrl } from '../utils/imageUtils';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';

const DEALER_CODE_LENGTH = 6;
const DEALER_CODE_PATTERN = /^\d{6}$/;

interface DealerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (dealer: Dealer) => void;
  dealer: Dealer | null;
}

export const DealerModal: React.FC<DealerModalProps> = ({ isOpen, onClose, onSave, dealer }) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [logo, setLogo] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    if (dealer) {
      setName(dealer.name);
      setCode(dealer.code || (/^\d+$/.test(dealer.id) ? dealer.id : ''));
      setLogo(dealer.logo);
    } else {
      setName('');
      setCode('');
      setLogo(undefined);
    }
    setError('');
  }, [dealer, isOpen]);

  const handleSave = () => {
    triggerHapticFeedback();
    if (!name.trim()) {
      setError('Dealer name is required.');
      return;
    }
    if (!DEALER_CODE_PATTERN.test(code)) {
      setError('Dealer code must be exactly 6 digits.');
      return;
    }
    onSave(
      dealer
        ? { ...dealer, name: name.trim(), code, logo }
        : { name: name.trim(), id: code, code, logo }
    );
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={dealer ? 'Edit dealer' : 'Add new dealer'}
      description="Dealer login codes must be exactly 6 digits."
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
          id="dealer-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Dealer name"
          fullWidth
        />

        <div>
          <Input
            id="dealer-code"
            type="text"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, '').slice(0, DEALER_CODE_LENGTH))
            }
            disabled={!!dealer}
            maxLength={DEALER_CODE_LENGTH}
            pattern="\d{6}"
            inputMode="numeric"
            placeholder="6-digit dealer code"
            className="font-mono tracking-[0.2em]"
            fullWidth
          />
          <p className="mt-1.5 px-1 text-xs text-surface-400">
            {dealer ? 'Dealer codes cannot be changed after creation.' : 'Used for dealer login, e.g. 123456.'}
          </p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-surface-300">
            Logo
          </label>
          <div className="flex items-center gap-4">
            {logo ? (
              <img
                src={logo}
                alt="Dealer logo"
                className="h-16 w-16 rounded-xl border border-white/10 bg-surface-950/50 object-contain p-2"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-primary-500/20 bg-primary-500/10">
                <Icon type="building-office" className="h-8 w-8 text-primary-300" />
              </div>
            )}
            <input
              type="file"
              accept="image/png, image/jpeg, image/webp"
              onChange={handleLogoChange}
              className="block w-full rounded-xl border border-dashed border-surface-700 bg-surface-950/40 px-4 py-3 text-sm text-surface-400 file:mr-4 file:rounded-full file:border-0 file:bg-primary-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-primary-700"
            />
          </div>
          {logo && (
            <button
              type="button"
              onClick={() => setLogo(undefined)}
              className="mt-2 text-xs font-medium text-error-300 hover:text-error-200"
            >
              Remove logo
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
