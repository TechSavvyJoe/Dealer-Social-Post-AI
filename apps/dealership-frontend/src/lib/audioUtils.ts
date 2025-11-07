/**
 * Audio Utilities for recording and encoding
 */

/**
 * Encode raw audio data (Uint8Array) into a Base64 string
 */
export function encodeAudio(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert Float32Array to Int16Array (PCM16)
 */
export function floatTo16BitPCM(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

/**
 * Resample audio to target sample rate
 */
export function resampleAudio(
  audioBuffer: Float32Array,
  originalSampleRate: number,
  targetSampleRate: number
): Float32Array {
  if (originalSampleRate === targetSampleRate) {
    return audioBuffer;
  }

  const sampleRateRatio = originalSampleRate / targetSampleRate;
  const newLength = Math.round(audioBuffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const index = i * sampleRateRatio;
    const indexFloor = Math.floor(index);
    const indexCeil = Math.min(indexFloor + 1, audioBuffer.length - 1);
    const fraction = index - indexFloor;
    result[i] = audioBuffer[indexFloor] * (1 - fraction) + audioBuffer[indexCeil] * fraction;
  }

  return result;
}

/**
 * Calculate audio level (RMS) from audio data
 */
export function calculateAudioLevel(audioData: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }
  const rms = Math.sqrt(sum / audioData.length);
  // Normalize to 0-100 range
  return Math.min(100, Math.round(rms * 300));
}

/**
 * Check if browser supports audio recording
 */
export function isBrowserSupported(): boolean {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * Request microphone permission
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop all tracks immediately - we just wanted to check permission
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (error) {
    console.error('Microphone permission denied:', error);
    return false;
  }
}
