/**
 * Application Constants
 */

export const APP_NAME = 'Dealership AI Sales Coach Suite';
export const APP_DESCRIPTION =
  'AI-powered sales coaching platform for automotive dealerships';

/**
 * API Configuration
 */
export const API_CONFIG = {
  GEMINI_API_KEY: import.meta.env.GEMINI_API_KEY || '',
  MODELS: {
    FLASH_AUDIO: 'gemini-2.5-flash-native-audio-preview-09-2025',
    PRO: 'gemini-2.5-pro',
    FLASH: 'gemini-2.5-flash',
  },
} as const;

/**
 * Audio Configuration
 */
export const AUDIO_CONFIG = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  BIT_DEPTH: 16,
  BUFFER_SIZE: 4096,
} as const;

/**
 * Sales Process Steps
 */
export const SALES_STEPS = [
  'Meet & Greet',
  'Needs Assessment',
  'Product Selection',
  'Demonstration',
  'Negotiation',
  'Close',
] as const;

/**
 * User Roles
 */
export const USER_ROLES = {
  SALESPERSON: 'salesperson',
  MANAGER: 'manager',
} as const;

/**
 * Storage Keys
 */
export const STORAGE_KEYS = {
  SALESPEOPLE: 'salespeople',
  SALES: 'sales',
  CURRENT_USER: 'currentUser',
  THEME: 'theme',
  LIVE_SALE_PREFIX: 'liveSale_',
} as const;

/**
 * Alert Severity Levels
 */
export const ALERT_SEVERITY = {
  CRITICAL: 'critical',
  OPPORTUNITY: 'opportunity',
  SUGGESTION: 'suggestion',
} as const;

/**
 * Sentiment Types
 */
export const SENTIMENT_TYPES = {
  POSITIVE: 'Positive',
  NEUTRAL: 'Neutral',
  NEGATIVE: 'Negative',
} as const;

/**
 * UI Configuration
 */
export const UI_CONFIG = {
  TOAST_DURATION: 3000,
  DEBOUNCE_DELAY: 300,
  THROTTLE_DELAY: 1000,
  ANIMATION_DURATION: 200,
  STAGGER_DELAY: 50,
} as const;

/**
 * Feature Flags
 */
export const FEATURES = {
  DARK_MODE: true,
  ANALYTICS: true,
  REAL_TIME_MONITORING: true,
  PRE_CALL_BRIEFING: true,
  PERFORMANCE_REPORTS: true,
} as const;

/**
 * Validation Rules
 */
export const VALIDATION = {
  MIN_NAME_LENGTH: 2,
  MAX_NAME_LENGTH: 50,
  MIN_TRANSCRIPT_LENGTH: 10,
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
} as const;

/**
 * Date/Time Formats
 */
export const DATE_FORMATS = {
  SHORT: 'MMM d, yyyy',
  LONG: 'MMMM d, yyyy',
  WITH_TIME: 'MMM d, yyyy h:mm a',
  TIME_ONLY: 'h:mm a',
} as const;
