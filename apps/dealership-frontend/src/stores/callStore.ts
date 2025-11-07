import { create } from 'zustand';
import { TranscriptSegment, CoachingAlert, SaleStep, LiveSaleData, SaleStatus } from '../types';
import { broadcastLiveSaleData, clearLiveSaleData } from '../services/realtimeService';

interface CallState {
  isRecording: boolean;
  isPaused: boolean;
  startTime: number | null;
  duration: number;
  transcript: TranscriptSegment[];
  summary: string | null;
  currentStep: SaleStep | null;
  sentiment: 'Positive' | 'Neutral' | 'Negative';
  successProbability: number;
  coachingAlerts: CoachingAlert[];
  audioLevel: number;

  // Actions
  startRecording: () => void;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  addTranscriptSegment: (segment: TranscriptSegment) => void;
  updateTranscriptSegment: (index: number, updates: Partial<TranscriptSegment>) => void;
  setSummary: (summary: string) => void;
  setCurrentStep: (step: SaleStep) => void;
  setSentiment: (sentiment: 'Positive' | 'Neutral' | 'Negative') => void;
  setSuccessProbability: (probability: number) => void;
  addCoachingAlert: (alert: CoachingAlert) => void;
  setAudioLevel: (level: number) => void;
  updateDuration: (duration: number) => void;
  resetCall: () => void;
}

const initialState = {
  isRecording: false,
  isPaused: false,
  startTime: null,
  duration: 0,
  transcript: [],
  summary: null,
  currentStep: null,
  sentiment: 'Neutral' as const,
  successProbability: 0,
  coachingAlerts: [],
  audioLevel: 0,
};

// Helper to broadcast live sale data to managers
const broadcastState = (state: CallState) => {
  // Only broadcast if recording
  if (!state.isRecording) return;

  // Get current user from auth store
  const authStore = JSON.parse(localStorage.getItem('auth-storage') || '{}');
  const currentUser = authStore?.state?.user;

  if (!currentUser) return;

  const liveData: LiveSaleData = {
    salespersonId: currentUser.id,
    salespersonName: currentUser.name,
    status: SaleStatus.LIVE,
    duration: state.duration,
    isPaused: state.isPaused,
    audioLevel: state.audioLevel,
    successProbability: state.successProbability,
    currentStep: state.currentStep,
    sentiment: state.sentiment === 'Positive' ? 'positive' : state.sentiment === 'Negative' ? 'negative' : 'neutral',
    transcript: state.transcript,
    liveTranscript: state.transcript.map(t => `${t.speaker}: ${t.text}`).join('\n'),
    diarizedTranscript: state.transcript.map(t => ({ speaker: t.speaker || 'Unknown', text: t.text })),
    participants: {
      salesperson: currentUser.name,
      customer: null,
    },
    coachingAlerts: state.coachingAlerts,
    dashboardData: {
      currentStep: state.currentStep,
      sentiment: state.sentiment,
      saleSuccessProbability: state.successProbability,
      keyTopics: [],
      coachingAlerts: state.coachingAlerts,
    },
  };

  broadcastLiveSaleData(liveData);
};

export const useCallStore = create<CallState>((set, get) => ({
  ...initialState,

  startRecording: () => {
    set({
      isRecording: true,
      isPaused: false,
      startTime: Date.now(),
      transcript: [],
      summary: null,
      coachingAlerts: [],
    });
    broadcastState(get());
  },

  stopRecording: () => {
    // Clear live broadcast when stopping
    const authStore = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    const currentUser = authStore?.state?.user;
    if (currentUser) {
      clearLiveSaleData(currentUser.id);
    }

    set({
      isRecording: false,
      isPaused: false,
      audioLevel: 0,
    });
  },

  pauseRecording: () => {
    set({ isPaused: true });
    broadcastState(get());
  },

  resumeRecording: () => {
    set({ isPaused: false });
    broadcastState(get());
  },

  addTranscriptSegment: (segment) => {
    set((state) => ({
      transcript: [...state.transcript, segment],
    }));
    broadcastState(get());
  },

  updateTranscriptSegment: (index, updates) => {
    set((state) => ({
      transcript: state.transcript.map((seg, i) =>
        i === index ? { ...seg, ...updates } : seg
      ),
    }));
    broadcastState(get());
  },

  setSummary: (summary) => {
    set({ summary });
    broadcastState(get());
  },

  setCurrentStep: (currentStep) => {
    set({ currentStep });
    broadcastState(get());
  },

  setSentiment: (sentiment) => {
    set({ sentiment });
    broadcastState(get());
  },

  setSuccessProbability: (successProbability) => {
    set({ successProbability });
    broadcastState(get());
  },

  addCoachingAlert: (alert) => {
    set((state) => ({
      coachingAlerts: [...state.coachingAlerts, alert],
    }));
    broadcastState(get());
  },

  setAudioLevel: (audioLevel) => {
    set({ audioLevel });
    broadcastState(get());
  },

  updateDuration: (duration) => {
    set({ duration });
    broadcastState(get());
  },

  resetCall: () => {
    const authStore = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    const currentUser = authStore?.state?.user;
    if (currentUser) {
      clearLiveSaleData(currentUser.id);
    }
    set(initialState);
  },
}));
