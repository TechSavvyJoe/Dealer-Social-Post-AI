import { useState, useRef, useCallback, useEffect } from 'react';
import { useCallStore } from '../stores/callStore';
import { AUDIO_CONFIG } from '../config/constants';
import {
  encodeAudio,
  floatTo16BitPCM,
  resampleAudio,
  calculateAudioLevel,
} from '../lib/audioUtils';

export interface UseAudioRecorderReturn {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  audioLevel: number;
  startRecording: () => Promise<boolean>;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  error: string | null;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [error, setError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const {
    isRecording,
    isPaused,
    duration,
    audioLevel,
    startRecording: startRecordingStore,
    stopRecording: stopRecordingStore,
    pauseRecording: pauseRecordingStore,
    resumeRecording: resumeRecordingStore,
    setAudioLevel,
    updateDuration,
  } = useCallStore();

  // Update duration timer
  useEffect(() => {
    if (!isRecording || isPaused) return;

    const interval = setInterval(() => {
      updateDuration(Date.now() - (useCallStore.getState().startTime || Date.now()));
    }, 100);

    return () => clearInterval(interval);
  }, [isRecording, isPaused, updateDuration]);

  // Audio level monitoring
  const monitorAudioLevel = useCallback(() => {
    if (!analyserRef.current || isPaused) {
      setAudioLevel(0);
      return;
    }

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(dataArray);

    // Calculate RMS level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const level = Math.min(100, Math.round(rms * 200));

    setAudioLevel(level);

    if (isRecording) {
      animationFrameRef.current = requestAnimationFrame(monitorAudioLevel);
    }
  }, [isRecording, isPaused, setAudioLevel]);

  const startRecording = useCallback(async (): Promise<boolean> => {
    try {
      setError(null);

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: AUDIO_CONFIG.SAMPLE_RATE,
        },
      });

      streamRef.current = stream;

      // Create audio context
      const audioContext = new AudioContext({ sampleRate: AUDIO_CONFIG.SAMPLE_RATE });
      audioContextRef.current = audioContext;

      // Create source node
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Create analyser for level monitoring
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      // Create processor for audio data
      const processor = audioContext.createScriptProcessor(
        AUDIO_CONFIG.BUFFER_SIZE,
        1,
        1
      );
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (isPaused) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Resample if needed
        const resampled = resampleAudio(
          inputData,
          audioContext.sampleRate,
          AUDIO_CONFIG.SAMPLE_RATE
        );

        // Convert to PCM16
        const pcm16 = floatTo16BitPCM(resampled);

        // Encode to base64
        const encoded = encodeAudio(new Uint8Array(pcm16.buffer));

        // TODO: Send to Gemini Live API
        // This would be where we send the audio data to the API
        // For now, we'll just handle it locally
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      // Start monitoring audio level
      monitorAudioLevel();

      // Update store
      startRecordingStore();

      return true;
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Failed to access microphone. Please grant permission and try again.');
      return false;
    }
  }, [isPaused, startRecordingStore, monitorAudioLevel]);

  const stopRecording = useCallback(() => {
    // Stop all audio processing
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Update store
    stopRecordingStore();
  }, [stopRecordingStore]);

  const pauseRecording = useCallback(() => {
    pauseRecordingStore();
    setAudioLevel(0);
  }, [pauseRecordingStore, setAudioLevel]);

  const resumeRecording = useCallback(() => {
    resumeRecordingStore();
    monitorAudioLevel();
  }, [resumeRecordingStore, monitorAudioLevel]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isRecording) {
        stopRecording();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isRecording,
    isPaused,
    duration,
    audioLevel,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    error,
  };
}
