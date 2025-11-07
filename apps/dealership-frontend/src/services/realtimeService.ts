import { LiveSaleData } from '../types';
import { STORAGE_KEYS } from '../config/constants';
import { storage } from '../lib/utils';

/**
 * Broadcast live sale data to other tabs/windows for real-time manager monitoring
 */
export const broadcastLiveSaleData = (data: LiveSaleData): void => {
  try {
    const key = `${STORAGE_KEYS.LIVE_SALE_PREFIX}${data.salespersonId}`;
    storage.set(key, data);

    // Manually trigger storage event for current window
    window.dispatchEvent(new StorageEvent('storage', {
      key,
      newValue: JSON.stringify(data),
      url: window.location.href,
      storageArea: localStorage,
    }));
  } catch (error) {
    console.error('Error broadcasting live sale data:', error);
  }
};

/**
 * Get live sale data for a specific salesperson
 */
export const getLiveSaleData = (salespersonId: string): LiveSaleData | null => {
  try {
    const key = `${STORAGE_KEYS.LIVE_SALE_PREFIX}${salespersonId}`;
    return storage.get<LiveSaleData>(key);
  } catch (error) {
    console.error('Error retrieving live sale data:', error);
    return null;
  }
};

/**
 * Get all active live sales
 */
export const getAllLiveSales = (): LiveSaleData[] => {
  try {
    const liveSales: LiveSaleData[] = [];

    // Iterate through all localStorage keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEYS.LIVE_SALE_PREFIX)) {
        const data = storage.get<LiveSaleData>(key);
        if (data) {
          liveSales.push(data);
        }
      }
    }

    return liveSales;
  } catch (error) {
    console.error('Error retrieving all live sales:', error);
    return [];
  }
};

/**
 * Clear live sale data for a specific salesperson
 */
export const clearLiveSaleData = (salespersonId: string): void => {
  try {
    const key = `${STORAGE_KEYS.LIVE_SALE_PREFIX}${salespersonId}`;
    const currentData = getLiveSaleData(salespersonId);

    // Only clear if it's the correct salesperson, to prevent race conditions
    if (currentData && currentData.salespersonId === salespersonId) {
      storage.remove(key);

      // Manually trigger an event for the current window
      window.dispatchEvent(new Event('storage'));
    }
  } catch (error) {
    console.error('Error clearing live sale data:', error);
  }
};

/**
 * Listen for live sale updates (for manager dashboard)
 */
export const subscribeLiveSaleUpdates = (
  callback: (data: LiveSaleData | null) => void
): (() => void) => {
  const handleStorageChange = (e: StorageEvent) => {
    if (e.key && e.key.startsWith(STORAGE_KEYS.LIVE_SALE_PREFIX)) {
      if (e.newValue) {
        try {
          const data = JSON.parse(e.newValue) as LiveSaleData;
          callback(data);
        } catch (error) {
          console.error('Error parsing live sale data:', error);
        }
      } else {
        // Sale was cleared
        callback(null);
      }
    }
  };

  window.addEventListener('storage', handleStorageChange);

  // Return cleanup function
  return () => {
    window.removeEventListener('storage', handleStorageChange);
  };
};
