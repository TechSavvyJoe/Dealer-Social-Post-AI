import React, { useState, useEffect, useRef } from 'react';
import { markdownToHtml } from '../utils/markdown';
import AudioVisualizer from './AudioVisualizer';
import RecordingIcon from './icons/RecordingIcon';
import ClipboardIcon from './icons/ClipboardIcon';
import BriefcaseIcon from './icons/BriefcaseIcon';
import { TranscriptSegment, SavedSale } from '../types';
import TranscriptSegmentView from './TranscriptSegmentView';
import PastSalesView from './PastSalesView';
import PrecallBriefingView from './PrecallBriefingView';

interface SalesmanViewProps {
  isRecording: boolean;
  isSummarizing: boolean;
  structuredTranscript: TranscriptSegment[];
  inProgressText: string;
  summary: string;
  audioLevel: number;
  onToggleRecording: () => void;
  onUpdateSegment: (segmentId: number, updates: { text: string; speaker: string; timestamp: string; }) => void;
  activeView: 'transcript' | 'summary' | 'history';
  setActiveView: (view: 'transcript' | 'summary' | 'history') => void;
  savedSales: SavedSale[];
}

const ToggleSwitch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
    <div className="flex items-center space-x-2">
      <span className="text-sm text-gray-400 font-medium">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 ${
          checked ? 'bg-blue-600' : 'bg-gray-600'
        }`}
        role="switch"
        aria-checked={checked}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
);


const SalesmanView: React.FC<SalesmanViewProps> = ({
  isRecording,
  isSummarizing,
  structuredTranscript,
  inProgressText,
  summary,
  audioLevel,
  onToggleRecording,
  onUpdateSegment,
  activeView,
  setActiveView,
  savedSales
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [isBriefingModalOpen, setIsBriefingModalOpen] = useState(false);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (summary && !isRecording && !isSummarizing) {
      setActiveView('summary');
    }
    if (isRecording) {
      setActiveView('transcript');
    }
  }, [summary, isRecording, isSummarizing, setActiveView]);
  
  useEffect(() => {
    if (isAutoScrollEnabled && transcriptContainerRef.current) {
        const element = transcriptContainerRef.current;
        element.scrollTop = element.scrollHeight;
    }
  }, [structuredTranscript, inProgressText, isAutoScrollEnabled]);

  const handleCopySummary = () => {
    if (!summary) return;

    const plainTextSummary = summary
        .replace(/<[^>]*>/g, '\n')
        .replace(/\n\n+/g, '\n\n')
        .trim();

    navigator.clipboard.writeText(plainTextSummary).then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    }).catch(err => {
        console.error('Failed to copy summary: ', err);
        alert('Could not copy summary to clipboard.');
    });
  };

  const TabButton: React.FC<{ view: 'transcript' | 'summary' | 'history', label: string }> = ({ view, label }) => (
    <button
      onClick={() => setActiveView(view)}
      disabled={isRecording}
      className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors duration-200 disabled:opacity-50
        ${activeView === view ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}
      `}
    >
      {label}
    </button>
  );

  return (
    <>
    <PrecallBriefingView
        isOpen={isBriefingModalOpen}
        onClose={() => setIsBriefingModalOpen(false)}
    />
    <div className="p-4 md:p-8 flex flex-col items-center h-[calc(100vh-80px)]">
      {activeView !== 'history' && (
        <>
            <div className="w-full max-w-4xl flex flex-col items-center">
                <div className="flex items-center gap-4 mb-4">
                    <button
                        onClick={() => setIsBriefingModalOpen(true)}
                        disabled={isRecording || isSummarizing}
                        className="h-24 px-6 bg-gray-700/50 border-2 border-gray-600 rounded-2xl flex items-center justify-center gap-3 text-gray-300 hover:bg-gray-700 hover:border-gray-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <BriefcaseIcon className="w-8 h-8"/>
                        <span className="font-semibold">Pre-call<br/>Briefing</span>
                    </button>
                    <div className="relative">
                        <button
                            onClick={onToggleRecording}
                            disabled={isSummarizing}
                            className={`
                            w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ease-in-out shadow-lg 
                            focus:outline-none focus:ring-4 focus:ring-opacity-50
                            ${isRecording ? 'bg-red-500/10 border-2 border-red-500 text-red-400' : 'bg-blue-500/10 border-2 border-blue-500 text-blue-400'}
                            ${isSummarizing ? 'bg-gray-500/10 border-gray-500 cursor-not-allowed text-gray-400' : 'hover:scale-110'}
                            `}
                        >
                            <RecordingIcon className="w-10 h-10" />
                            {isRecording && <div className="absolute inset-0 rounded-full animate-glow"></div>}
                        </button>
                    </div>
                </div>

                <p className="mb-2 text-lg text-gray-300 font-semibold h-7">
                {isSummarizing ? "Generating Report..." : (isRecording ? "Recording in Progress..." : "Ready to Record")}
                </p>

                <div className="h-10 mb-6">
                {isRecording && <AudioVisualizer level={audioLevel} />}
                </div>
            </div>
        </>
      )}

      {activeView === 'history' ? (
        <div className="w-full h-full">
            <PastSalesView sales={savedSales} />
        </div>
      ) : (
        <div className="w-full max-w-4xl flex-grow flex flex-col bg-gray-800/50 border border-gray-700/50 rounded-2xl shadow-xl overflow-hidden">
            <div className="p-4 border-b border-gray-700/50 flex space-x-2">
              <TabButton view="transcript" label="Live Transcript" />
              <TabButton view="summary" label="Sale Summary" />
              <TabButton view="history" label="History" />
            </div>
          
          <div className="flex-grow overflow-hidden">
            {activeView === 'transcript' && (
              <div className="h-full flex flex-col">
                <div className="sticky top-0 bg-gray-800/80 backdrop-blur-sm z-10 p-4 border-b border-gray-700/50 flex justify-between items-center shrink-0">
                    <h2 className="text-2xl font-bold text-blue-400">Live Transcript</h2>
                    <ToggleSwitch
                      checked={isAutoScrollEnabled}
                      onChange={setIsAutoScrollEnabled}
                      label="Auto-Scroll"
                    />
                </div>
                <div ref={transcriptContainerRef} className="flex-grow p-6 overflow-y-auto space-y-4">
                  {structuredTranscript.length === 0 && !inProgressText && (
                     <div className="text-center text-gray-500 pt-10">
                      <p>{isRecording ? "Listening..." : "Start a recording to see the live transcript."}</p>
                    </div>
                  )}
                  {structuredTranscript.map(segment => (
                    <TranscriptSegmentView key={segment.id} segment={segment} onUpdate={onUpdateSegment} />
                  ))}
                   {inProgressText && (
                    <div className="opacity-60">
                      <TranscriptSegmentView 
                          segment={{id: 0, text: inProgressText, timestamp: "..."}} 
                          onUpdate={() => {}} 
                          isWIP
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeView === 'summary' && (
               <div className="h-full p-6 overflow-y-auto">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-blue-400">Sale Summary</h2>
                    {summary && !isSummarizing && (
                      <button
                        onClick={handleCopySummary}
                        disabled={isCopied}
                        className={`flex items-center px-3 py-1.5 text-sm font-semibold rounded-lg transition-all duration-200
                          ${isCopied ? 'bg-green-600 text-white cursor-default' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}
                        `}
                      >
                        <ClipboardIcon className="w-4 h-4 mr-2" />
                        {isCopied ? 'Copied!' : 'Copy Text'}
                      </button>
                    )}
                  </div>
                  {summary ? (
                    <div className="prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: markdownToHtml(summary) }} />
                  ) : isSummarizing ? (
                    <div className="text-center text-gray-400 pt-10">
                        <p>Analyzing conversation and preparing your summary...</p>
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 pt-10">
                      <p>Your conversation summary will appear here after you finish recording.</p>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </>
  );
};

export default SalesmanView;
