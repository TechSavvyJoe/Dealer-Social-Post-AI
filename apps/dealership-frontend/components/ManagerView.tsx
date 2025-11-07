import React, { useEffect, useState, useRef, useMemo } from 'react';
import { CoachingAlertItem } from '../services/geminiService';
import { DialogueTurn } from '../services/geminiLiveService';
import TranscriptIcon from './icons/TranscriptIcon';
import CoachingIcon from './icons/CoachingIcon';
import InsightsIcon from './icons/InsightsIcon';
import CoachingAlert from './CoachingAlert';
import { LiveCallData } from '../types';
import ChevronLeftIcon from './icons/ChevronLeftIcon';
import SaleStepIndicator from './SaleStepIndicator';
import { ManagerDashboardData } from '../services/geminiService';

interface ManagerViewProps {
  initialCallData: LiveCallData;
  onExit: () => void;
}

const getSpeakerInitials = (speaker: string): string => {
  if (!speaker) return '?';
  const nameMatch = speaker.match(/\(([^)]+)\)/);
  if (nameMatch) {
    return nameMatch[1].substring(0, 2).toUpperCase();
  }
  if (speaker.toLowerCase().includes('sales')) return 'SL';
  if (speaker.toLowerCase().includes('cust')) return 'C';
  return speaker.substring(0, 2).toUpperCase();
};

const getSpeakerColor = (speaker: string): string => {
  if (speaker.toLowerCase().includes('sales')) return 'bg-blue-500';
  if (speaker.toLowerCase().includes('cust')) return 'bg-green-500';
  return 'bg-gray-500';
}

const SentimentIndicator: React.FC<{ sentiment: ManagerDashboardData['sentiment'] }> = ({ sentiment }) => {
    const sentimentConfig = {
        Positive: { color: 'bg-green-500', text: 'Positive' },
        Neutral: { color: 'bg-yellow-500', text: 'Neutral' },
        Negative: { color: 'bg-red-500', text: 'Negative' },
        Unknown: { color: 'bg-gray-500', text: 'Analyzing...' },
    };
    const config = sentimentConfig[sentiment] || sentimentConfig.Unknown;
    return (
        <div className="flex items-center space-x-3">
            <span className={`relative flex h-3 w-3`}>
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.color} opacity-75`}></span>
                <span className={`relative inline-flex rounded-full h-3 w-3 ${config.color}`}></span>
            </span>
            <span className="text-lg font-medium text-gray-200">{config.text}</span>
        </div>
    );
};

const ManagerView: React.FC<ManagerViewProps> = ({ initialCallData, onExit }) => {
  const [liveCallData, setLiveCallData] = useState<LiveCallData>(initialCallData);
  const [activeAlerts, setActiveAlerts] = useState<CoachingAlertItem[]>([]);
  const shownAlertsRef = useRef(new Set<string>());
  const dashboardData = liveCallData.dashboardData;
  
  useEffect(() => {
    const handleStorageChange = () => {
        const currentDataJSON = localStorage.getItem('live-call-data');
        if (currentDataJSON) {
            const currentData = JSON.parse(currentDataJSON);
            if (currentData.salespersonId === initialCallData.salespersonId) {
                setLiveCallData(currentData);
            } else {
                onExit(); // Different call is live, exit this view
            }
        } else {
            onExit(); // Call has ended
        }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [initialCallData.salespersonId, onExit]);


  useEffect(() => {
    if (dashboardData?.coachingAlerts && dashboardData.coachingAlerts.length > 0) {
        const newAlerts = dashboardData.coachingAlerts.filter(
            alert => !shownAlertsRef.current.has(alert.issue)
        );
        if (newAlerts.length > 0) {
            newAlerts.forEach(alert => shownAlertsRef.current.add(alert.issue));
            setActiveAlerts(prev => [...newAlerts, ...prev]);
        }
    }
  }, [dashboardData]);

  
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [liveCallData.diarizedTranscript]);

  const handleDismissAlert = (alertIssue: string) => {
    setActiveAlerts(prev => prev.filter(alert => alert.issue !== alertIssue));
  };
  
  const formatSpeakerName = (speaker: string): string => {
    const nameMatch = speaker.match(/\(([^)]+)\)/);
    if (nameMatch && nameMatch[1]) {
      return nameMatch[1]; // "Salesperson (John)" -> "John"
    }
    if (speaker.toLowerCase().includes('sales')) return liveCallData.salespersonName;
    if (speaker.toLowerCase().includes('cust')) return 'Customer';
    return speaker;
  };

  const displayTranscript = useMemo(() => {
    return liveCallData.diarizedTranscript.map(turn => {
      let finalSpeaker = turn.speaker;
      const isSalespersonTurn = turn.speaker.toLowerCase().includes('sales');
      const isCustomerTurn = turn.speaker.toLowerCase().includes('cust');

      if (liveCallData.participants.salesperson && isSalespersonTurn) {
        finalSpeaker = `Salesperson (${liveCallData.participants.salesperson})`;
      }
      if (liveCallData.participants.customer && isCustomerTurn) {
        finalSpeaker = `Customer (${liveCallData.participants.customer})`;
      }
      return { ...turn, speaker: finalSpeaker };
    });
  }, [liveCallData.diarizedTranscript, liveCallData.participants]);


  return (
    <>
      <div className="fixed top-24 right-6 w-full max-w-sm z-50 space-y-4">
        {activeAlerts.map((alert) => (
            <CoachingAlert 
                key={alert.issue + Math.random()} 
                alert={alert} 
                onDismiss={() => handleDismissAlert(alert.issue)} 
            />
        ))}
      </div>
      <div className="p-4 md:p-6 h-[calc(100vh-80px)]">
         <div className="w-full h-full max-w-8xl mx-auto flex flex-col">
            <div className="mb-4 flex justify-between items-center">
                 <button onClick={onExit} className="flex items-center gap-2 text-sm text-gray-300 hover:text-white font-semibold transition-colors">
                     <ChevronLeftIcon className="w-5 h-5" />
                     Back to Dashboard
                 </button>
                 <div className="text-right">
                    <h3 className="font-semibold text-lg text-gray-200">Monitoring: <span className="text-blue-300">{liveCallData.salespersonName}</span></h3>
                 </div>
            </div>
            <div className="mb-4">
                <SaleStepIndicator currentStep={dashboardData?.currentSalesStep || 'Unknown'} />
            </div>
          <div className="w-full flex-grow flex flex-col lg:flex-row gap-6 overflow-hidden">
            {/* Left Panel: AI Coaching */}
            <div className="lg:w-1/4 bg-gray-800/50 border border-gray-700/50 p-6 rounded-2xl shadow-xl flex flex-col">
              <h2 className="text-xl font-bold mb-4 text-indigo-300 flex items-center shrink-0"><CoachingIcon className="w-6 h-6 mr-3"/>AI Coaching</h2>
              <div className="flex-grow overflow-y-auto pr-2">
                {!dashboardData?.suggestions ? (
                  <p className="text-gray-500 animate-pulse">Analyzing for coaching opportunities...</p>
                ) : (
                  <div className="prose prose-invert max-w-none prose-p:text-gray-300" dangerouslySetInnerHTML={{ __html: dashboardData.suggestions }} />
                )}
              </div>
            </div>

            {/* Center Panel: Live Conversation */}
            <div className="lg:w-1/2 bg-gray-800/50 border border-gray-700/50 p-6 rounded-2xl shadow-xl flex flex-col">
              <h2 className="text-xl font-bold mb-4 text-blue-300 flex items-center shrink-0">
                <TranscriptIcon className="w-6 h-6 mr-3"/>
                Live Conversation
                <span className="relative flex h-3 w-3 ml-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </span>
              </h2>
              <div className="mb-4 border-b border-gray-700/50 pb-4 text-sm shrink-0">
                  <h3 className="font-semibold text-gray-400 mb-2">Participants</h3>
                  <div className="flex items-center space-x-6">
                      <p><span className="text-gray-500">Salesperson:</span> <span className="font-medium text-blue-300">{liveCallData.participants.salesperson || liveCallData.salespersonName}</span></p>
                      <p><span className="text-gray-500">Customer:</span> <span className="font-medium text-green-300">{liveCallData.participants.customer || '...'}</span></p>
                  </div>
              </div>
              <div ref={transcriptContainerRef} className="flex-grow overflow-y-auto pr-2 space-y-4">
                  {displayTranscript.length > 0 ? displayTranscript.map((turn, index) => (
                      <div key={index} className="flex items-start space-x-3">
                          <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-white ${getSpeakerColor(turn.speaker)}`}>
                              {getSpeakerInitials(turn.speaker)}
                          </div>
                          <div className="flex-grow">
                              <div className="text-sm font-bold text-gray-300">{formatSpeakerName(turn.speaker)}</div>
                              <div className="bg-gray-700/50 p-3 rounded-lg text-gray-200">
                                  {turn.text}
                              </div>
                          </div>
                      </div>
                  )) : <p className="text-gray-500 text-center pt-10">Waiting for conversation to start...</p>}
              </div>
            </div>
            
            {/* Right Panel: Key Insights */}
            <div className="lg:w-1/4 bg-gray-800/50 border border-gray-700/50 p-6 rounded-2xl shadow-xl flex flex-col">
              <h2 className="text-xl font-bold mb-4 text-amber-300 flex items-center shrink-0"><InsightsIcon className="w-6 h-6 mr-3"/>Key Insights</h2>
              <div className="flex-grow overflow-y-auto pr-2 space-y-6">
                <div>
                    <h3 className="text-lg font-semibold text-gray-200 mb-3">Sentiment</h3>
                    <SentimentIndicator sentiment={dashboardData?.sentiment || 'Unknown'} />
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-gray-200 mb-3">Live Summary</h3>
                    <p className="text-gray-400 leading-relaxed">{dashboardData?.liveSummary || "A summary will be generated shortly..."}</p>
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-gray-200 mb-3">Overall Summary</h3>
                    <p className="text-gray-400 leading-relaxed">{dashboardData?.overallSummary || "An overall summary will be generated shortly..."}</p>
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-gray-200 mb-3">Key Topics</h3>
                    {dashboardData?.keyTopics && dashboardData.keyTopics.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                          {dashboardData.keyTopics.map((topic, index) => (
                              <span key={index} className="bg-gray-700 text-amber-300 text-sm font-medium px-3 py-1 rounded-full">{topic}</span>
                          ))}
                      </div>
                    ) : (
                       <p className="text-gray-500">Identifying topics...</p>
                    )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default ManagerView;