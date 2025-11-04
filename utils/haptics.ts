/**
 * Triggers a short haptic feedback vibration on supported devices.
 */
export const triggerHapticFeedback = () => {
  if (navigator.vibrate) {
    // A short, crisp vibration.
    navigator.vibrate(50);
  }
};
