import { ManagerDashboardData } from './services/geminiService';

export enum UserRole {
  SALESMAN = 'salesman',
  MANAGER = 'manager',
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
}

export interface Salesperson {
  id: string;
  name: string;
}

export enum SaleStatus {
  LIVE = 'live',
  IDLE = 'idle',
}

export interface LiveCallData {
  salespersonId: string;
  salespersonName: string;
  status: SaleStatus;
  liveTranscript: string;
  diarizedTranscript: any[]; // DialogueTurn[] from geminiLiveService
  participants: { salesperson: string | null; customer: string | null };
  dashboardData: ManagerDashboardData | null;
}

export interface TranscriptSegment {
  id: number;
  timestamp: string;
  text: string;
  speaker?: string;
}

export interface SalesStepAnalysis {
    stepName: 'Greeting' | 'Building a Profile' | 'Appraisal' | 'Selection & Demonstration' | 'Write Up & Presentation' | 'Delivery & Follow Up';
    score: number; // Score out of 10
    positiveFeedback: string;
    areaForImprovement: string;
}

export interface PerformanceReport {
    stepByStepAnalysis: SalesStepAnalysis[];
    overallCoachingSummary: string; // Markdown text
}


export interface SavedSale {
  id: number;
  date: string;
  salespersonName: string;
  customerName:string;
  transcript: TranscriptSegment[];
  summary: string;
  performanceReport?: PerformanceReport;
  saleSuccessProbability?: number;
}