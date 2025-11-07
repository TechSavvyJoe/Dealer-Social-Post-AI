import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
// FIX: Removed unexported 'LiveSession' type. The promise from ai.live.connect is used and its resolved type is inferred.
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { User, UserRole, TranscriptSegment, SavedSale, LiveCallData, SaleStatus } from './types';
import { getSummary, getPerformanceReport, getManagerDashboardData, ManagerDashboardData } from './services/geminiService';
import { encode } from './utils/audioUtils';
import { DialogueTurn, processTranscriptForDiarization, SpeakerMap } from './services/geminiLiveService';
import { getAllSales, saveSale } from './services/storageService';
import { broadcastLiveCallData, clearLiveCallData } from './services/realtimeService';

import LoginView from './components/LoginView';
import SalesmanView from './components/SalesmanView';
import ManagerView from './components/ManagerView';
import ManagerDashboard from './components/ManagerDashboard';
import LogoutIcon from './components/icons/LogoutIcon';
import ManagerAnalyticsView from './components/ManagerAnalyticsView';

const App: React.FC = () => {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isRecording, setIsRecording] = useState<boolean>(false);
    const [isSummarizing, setIsSummarizing] = useState<boolean>(false);
    const [liveTranscript, setLiveTranscript] = useState<string>('');
    const [summary, setSummary] = useState<string>('');
    const [audioLevel, setAudioLevel] = useState(0);
    const [salesmanActiveView, setSalesmanActiveView] = useState<'transcript' | 'summary' | 'history'>('transcript');
    const [savedSales, setSavedSales] = useState<SavedSale[]>([]);
    
    // For manager view
    const [monitoringCall, setMonitoringCall] = useState<LiveCallData | null>(null);
    const [managerView, setManagerView] = useState<'dashboard' | 'analytics'>('dashboard');

    // FIX: Changed LiveSession to any as it's not an exported type from the library.
    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const analyserNodeRef = useRef<AnalyserNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const audioDataArrayRef = useRef<Uint8Array | null>(null);
    const animationFrameIdRef = useRef<number | null>(null);
    
    const [structuredTranscript, setStructuredTranscript] = useState<TranscriptSegment[]>([]);
    const [inProgressText, setInProgressText] = useState<string>('');
    
    const [diarizedTranscript, setDiarizedTranscript] = useState<DialogueTurn[]>([]);
    const [participants, setParticipants] = useState<{ salesperson: string | null; customer: string | null }>({ salesperson: null, customer: null });
    const knownSpeakersRef = useRef<SpeakerMap>(new Map());
    const processingTimeoutRef = useRef<number | null>(null);
    const [isDiarizing, setIsDiarizing] = useState(false);
    
    const [dashboardData, setDashboardData] = useState<ManagerDashboardData | null>(null);
    const dashboardProcessingTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        setSavedSales(getAllSales());
    }, []);

    useEffect(() => {
        const newRawTranscript = structuredTranscript.map(segment => segment.text).join(' ');
        setLiveTranscript(newRawTranscript);
    }, [structuredTranscript]);
    
    useEffect(() => {
        if (!isRecording || liveTranscript.trim().length < 50) {
          setDashboardData(null);
          if (dashboardProcessingTimeoutRef.current) clearTimeout(dashboardProcessingTimeoutRef.current);
          return;
        }

        const processDashboardData = async () => {
           const newData = await getManagerDashboardData(liveTranscript);
           if (newData) {
                setDashboardData(newData);
           }
        };
        
        if (dashboardProcessingTimeoutRef.current) clearTimeout(dashboardProcessingTimeoutRef.current);
        dashboardProcessingTimeoutRef.current = window.setTimeout(processDashboardData, 3000);

        return () => {
          if (dashboardProcessingTimeoutRef.current) clearTimeout(dashboardProcessingTimeoutRef.current);
        };
    }, [liveTranscript, isRecording]);


    useEffect(() => {
        if (!isRecording) return;
        
        const broadcast = () => {
            if (currentUser && currentUser.role === UserRole.SALESMAN) {
                broadcastLiveCallData({
                    salespersonId: currentUser.id,
                    salespersonName: currentUser.name,
                    status: isRecording ? SaleStatus.LIVE : SaleStatus.IDLE,
                    liveTranscript,
                    diarizedTranscript,
                    participants,
                    dashboardData
                });
            }
        };

        const broadcastDebounce = setTimeout(broadcast, 500);
        return () => clearTimeout(broadcastDebounce);

    }, [liveTranscript, diarizedTranscript, participants, isRecording, currentUser, dashboardData]);

    useEffect(() => {
        if (!isRecording) {
            setDiarizedTranscript([]);
            setParticipants({ salesperson: null, customer: null });
            knownSpeakersRef.current.clear();
            if(processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
            return;
        }

        const processData = async () => {
            if (isDiarizing) return;
            setIsDiarizing(true);

            const { updatedTurns, updatedSpeakers } = await processTranscriptForDiarization(liveTranscript, knownSpeakersRef.current);
            if (updatedTurns) {
                setDiarizedTranscript(updatedTurns);
                knownSpeakersRef.current = updatedSpeakers;
            }
            setIsDiarizing(false);
        };
        
        if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = window.setTimeout(processData, 3000);

        return () => {
          if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
        };
    }, [liveTranscript, isRecording]);
    
    useEffect(() => {
        const salespersonName = knownSpeakersRef.current.get('Salesperson') || null;
        const customerName = knownSpeakersRef.current.get('Customer') || null;
        setParticipants(prev => {
            if (prev.salesperson !== salespersonName || prev.customer !== customerName) {
                return { salesperson: salespersonName, customer: customerName };
            }
            return prev;
        });
    }, [diarizedTranscript]);


    const monitorAudioLevel = useCallback(() => {
        if (!analyserNodeRef.current || !audioDataArrayRef.current || !isRecording) {
            if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
            return;
        }
        
        analyserNodeRef.current.getByteFrequencyData(audioDataArrayRef.current);
        const average = audioDataArrayRef.current.reduce((sum, value) => sum + value, 0) / audioDataArrayRef.current.length;
        setAudioLevel(average / 128);

        animationFrameIdRef.current = requestAnimationFrame(monitorAudioLevel);
    }, [isRecording]);

    useEffect(() => {
        if (isRecording) {
            monitorAudioLevel();
        } else {
             if (animationFrameIdRef.current) {
                cancelAnimationFrame(animationFrameIdRef.current);
                setAudioLevel(0);
            }
        }
        return () => {
            if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
        };
    }, [isRecording, monitorAudioLevel]);

    const startRecording = async () => {
        if (!process.env.API_KEY) {
            alert("API_KEY is not configured.");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            setIsRecording(true);
            setLiveTranscript('');
            setStructuredTranscript([]);
            setInProgressText('');
            setSummary('');
            setSalesmanActiveView('transcript');
            
            let currentUtterance = '';
            
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
            mediaStreamSourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
            
            analyserNodeRef.current = audioContextRef.current.createAnalyser();
            analyserNodeRef.current.fftSize = 256;
            const bufferLength = analyserNodeRef.current.frequencyBinCount;
            audioDataArrayRef.current = new Uint8Array(bufferLength);

            gainNodeRef.current = audioContextRef.current.createGain();
            gainNodeRef.current.gain.value = 0;
            
            mediaStreamSourceRef.current.connect(analyserNodeRef.current);
            mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(gainNodeRef.current);
            gainNodeRef.current.connect(audioContextRef.current.destination);

            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        scriptProcessorRef.current!.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const l = inputData.length;
                            const int16 = new Int16Array(l);
                            for (let i = 0; i < l; i++) {
                                int16[i] = inputData[i] * 32768;
                            }
                            const pcmBlob: Blob = {
                                data: encode(new Uint8Array(int16.buffer)),
                                mimeType: 'audio/pcm;rate=16000',
                            };
                            sessionPromiseRef.current?.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };
                    },
                    onmessage: (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const text = message.serverContent.inputTranscription.text;
                            currentUtterance += text;
                            setInProgressText(currentUtterance);
                        }
                        if (message.serverContent?.turnComplete) {
                           if (currentUtterance.trim().length > 0) {
                                const newSegment: TranscriptSegment = {
                                    id: Date.now(),
                                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                                    text: currentUtterance.trim(),
                                    speaker: '...'
                                };
                                setStructuredTranscript(prev => [...prev, newSegment]);
                                currentUtterance = '';
                                setInProgressText('');
                           }
                        }
                    },
                    onerror: (e: ErrorEvent) => console.error('Session error:', e),
                    onclose: (e: CloseEvent) => console.log('Session closed.'),
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                },
            });

        } catch (error) {
            console.error('Failed to start recording:', error);
            alert('Could not start recording. Please ensure you have given microphone permissions.');
            setIsRecording(false);
        }
    };

    const stopRecording = useCallback(async () => {
        setIsRecording(false);
        setInProgressText('');

        if (currentUser) {
            clearLiveCallData(currentUser.id);
        }

        if (sessionPromiseRef.current) {
            const session = await sessionPromiseRef.current;
            session.close();
            sessionPromiseRef.current = null;
        }

        if (mediaStreamSourceRef.current) {
            mediaStreamSourceRef.current.mediaStream.getTracks().forEach(track => track.stop());
            mediaStreamSourceRef.current.disconnect();
        }
        if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
        if(analyserNodeRef.current) analyserNodeRef.current.disconnect();
        if(gainNodeRef.current) gainNodeRef.current.disconnect();
        if(audioContextRef.current && audioContextRef.current.state !== 'closed') audioContextRef.current.close();
        
        const finalTranscriptText = structuredTranscript.map(s => s.text).join(' ');
        if (finalTranscriptText.trim().length > 0 && currentUser) {
            setIsSummarizing(true);

            // Get the final dashboard data one last time for the probability score
            const finalDashboardData = await getManagerDashboardData(finalTranscriptText);

            const [finalSummary, performanceReport] = await Promise.all([
                getSummary(finalTranscriptText),
                getPerformanceReport(finalTranscriptText)
            ]);
            
            setSummary(finalSummary);
            
            const newSale: SavedSale = {
                id: Date.now(),
                date: new Date().toLocaleString(),
                salespersonName: participants.salesperson || currentUser.name,
                customerName: participants.customer || 'Customer',
                transcript: structuredTranscript,
                summary: finalSummary,
                performanceReport: performanceReport || undefined,
                saleSuccessProbability: finalDashboardData?.saleSuccessProbability
            };
            const updatedSales = saveSale(newSale);
            setSavedSales(updatedSales);
            setIsSummarizing(false);
        }
    }, [structuredTranscript, participants, currentUser]);

    const handleToggleRecording = () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };

    const handleUpdateSegment = (segmentId: number, updates: { text: string; speaker: string; timestamp: string; }) => {
        setStructuredTranscript(prev =>
            prev.map(segment =>
                segment.id === segmentId ? { ...segment, ...updates } : segment
            )
        );
    };
    
    const displayTranscript = useMemo(() => {
        if (diarizedTranscript.length === 0) return structuredTranscript;
        const fullDiarizedText = diarizedTranscript.map(t => t.text).join(' ');
        let searchIndex = 0;
        return structuredTranscript.map(segment => {
            const segmentIndex = fullDiarizedText.indexOf(segment.text, searchIndex);
            let speaker = segment.speaker;
            if (segmentIndex !== -1) {
                let charCount = 0;
                for (const turn of diarizedTranscript) {
                    const turnEnd = charCount + turn.text.length;
                    if (segmentIndex >= charCount && segmentIndex < turnEnd) {
                        speaker = turn.speaker;
                        break;
                    }
                    charCount = turnEnd + 1;
                }
                searchIndex = segmentIndex + segment.text.length;
            }
            return { ...segment, speaker };
        });
    }, [structuredTranscript, diarizedTranscript]);
    
    const handleLogout = () => {
        if (isRecording) {
           stopRecording();
        }
        setCurrentUser(null);
        setMonitoringCall(null);
        setManagerView('dashboard');
        // Reset all states
        setLiveTranscript('');
        setStructuredTranscript([]);
        setInProgressText('');
        setSummary('');
    }

    const renderContent = () => {
        if (!currentUser) {
            return <LoginView onLogin={setCurrentUser} />;
        }

        if (currentUser.role === UserRole.SALESMAN) {
            return (
                <SalesmanView
                    isRecording={isRecording}
                    structuredTranscript={displayTranscript}
                    inProgressText={inProgressText}
                    onUpdateSegment={handleUpdateSegment}
                    isSummarizing={isSummarizing}
                    summary={summary}
                    audioLevel={audioLevel}
                    onToggleRecording={handleToggleRecording}
                    activeView={salesmanActiveView}
                    setActiveView={setSalesmanActiveView}
                    savedSales={savedSales}
                />
            );
        }

        if (currentUser.role === UserRole.MANAGER) {
            if (monitoringCall) {
                return <ManagerView 
                    initialCallData={monitoringCall}
                    onExit={() => setMonitoringCall(null)}
                 />
            }
            if (managerView === 'analytics') {
                return <ManagerAnalyticsView 
                    sales={savedSales} 
                    onExit={() => setManagerView('dashboard')} 
                />
            }
            return <ManagerDashboard 
                onSelectCall={setMonitoringCall} 
                onShowAnalytics={() => setManagerView('analytics')}
            />;
        }
    };

    return (
        <div className="bg-gray-900 text-white min-h-screen font-sans">
            <header className="bg-gray-900/50 backdrop-blur-lg border-b border-gray-700/50 sticky top-0 z-50 h-[80px]">
                <div className="container mx-auto flex justify-between items-center p-4 h-full">
                    <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">
                        AI Sales Coach Suite
                    </h1>
                    {currentUser && (
                        <div className="flex items-center gap-4">
                            <span className="text-gray-300">Welcome, <span className="font-bold text-white">{currentUser.name}</span></span>
                            <button
                                onClick={handleLogout}
                                className="flex items-center gap-2 text-sm bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg font-semibold transition-colors"
                            >
                               <LogoutIcon className="w-4 h-4" /> Logout
                            </button>
                        </div>
                    )}
                </div>
            </header>
            <main className="transition-opacity duration-500">
                {renderContent()}
            </main>
        </div>
    );
};

export default App;
