/**
 * Core Types and Interfaces
 */

export enum UserRole {
  SALESMAN = 'salesman',
  MANAGER = 'manager',
}

export interface User {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
}

export interface Salesperson {
  id: string;
  name: string;
  email?: string;
}

export enum SaleStatus {
  LIVE = 'live',
  IDLE = 'idle',
}

export interface TranscriptSegment {
  id: number;
  timestamp: string;
  text: string;
  speaker?: string;
}

export interface DialogueTurn {
  speaker: string;
  text: string;
}

export interface LiveSaleData {
  salespersonId: string;
  salespersonName: string;
  status: SaleStatus;
  duration: number;
  isPaused: boolean;
  audioLevel: number;
  successProbability: number;
  currentStep: SaleStep | null;
  sentiment: 'positive' | 'neutral' | 'negative';
  transcript: TranscriptSegment[];
  liveTranscript: string;
  diarizedTranscript: DialogueTurn[];
  participants: {
    salesperson: string | null;
    customer: string | null;
  };
  coachingAlerts: CoachingAlert[];
  dashboardData: ManagerDashboardData | null;
}

export type SaleStep =
  | 'Greeting'
  | 'Building a Profile'
  | 'Appraisal'
  | 'Selection & Demonstration'
  | 'Write Up & Presentation'
  | 'Delivery & Follow Up';

export interface SalesStepAnalysis {
  stepName: SaleStep;
  score: number;
  positiveFeedback: string;
  areaForImprovement: string;
}

export interface PerformanceReport {
  steps: SalesStepAnalysis[];
  stepByStepAnalysis: SalesStepAnalysis[];
  overallScore: number;
  overallCoachingSummary: string;
}

export interface SavedSale {
  id: number;
  salespersonId: string;
  date: string;
  timestamp: string;
  duration: number;
  salespersonName: string;
  customerName: string;
  transcript: TranscriptSegment[];
  summary: string;
  performanceReport?: PerformanceReport;
  saleSuccessProbability?: number;
}

export interface CoachingAlert {
  id: string;
  type: 'critical' | 'opportunity' | 'suggestion';
  title: string;
  description: string;
  timestamp: string;
}

export interface ManagerDashboardData {
  currentStep: SaleStep | null;
  sentiment: 'Positive' | 'Neutral' | 'Negative';
  saleSuccessProbability: number;
  keyTopics: string[];
  coachingAlerts: CoachingAlert[];
}

export interface PrecallBriefingInput {
  customerName: string;
  vehicleOfInterest: string;
  budget: string;
  tradeIn: string;
  additionalNotes?: string;
}

export interface PrecallBriefing {
  customerProfile: string;
  keyTalkingPoints: string[];
  strategicQuestions: string[];
  anticipatedObjections: string[];
  rapportBuildingTips: string[];
}
