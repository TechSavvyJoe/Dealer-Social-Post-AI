import { LiveCallData } from '../types';

const LIVE_CALL_DATA_KEY = 'live-call-data';

export const broadcastLiveCallData = (data: LiveCallData) => {
  try {
    // We broadcast by setting an item in localStorage. Other tabs will get a 'storage' event.
    localStorage.setItem(LIVE_CALL_DATA_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Error broadcasting live call data:', error);
  }
};

export const clearLiveCallData = (salespersonId: string) => {
    try {
        const currentData = getLiveCallData();
        // Only clear if it's the correct salesperson, to prevent race conditions
        if (currentData && currentData.salespersonId === salespersonId) {
            localStorage.removeItem(LIVE_CALL_DATA_KEY);
             // Manually trigger an event for the current window if needed, as removeItem doesn't always.
            window.dispatchEvent(new Event('storage'));
        }
    } catch (error) {
        console.error('Error clearing live call data:', error);
    }
}

export const getLiveCallData = (): LiveCallData | null => {
    try {
        const data = localStorage.getItem(LIVE_CALL_DATA_KEY);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('Error retrieving live call data:', error);
        return null;
    }
}
