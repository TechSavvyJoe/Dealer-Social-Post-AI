import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { LogOut, FileText, BarChart3, ClipboardList, Sparkles } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useCallStore } from '../stores/callStore';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { AudioWaveform, AudioLevelIndicator } from '../components/features/AudioWaveform';
import { RecordingControls } from '../components/features/RecordingControls';
import { TranscriptDisplay } from '../components/features/TranscriptDisplay';
import { CoachingAlertsList } from '../components/features/CoachingAlert';
import { PrecallBriefing } from '../components/features/PrecallBriefing';
import { SalesHistory } from '../components/features/SalesHistory';
import { PerformanceReportViewer } from '../components/features/PerformanceReportViewer';
import { ThemeToggleInline } from '../components/ui/theme-toggle';
import { getRecentSales, createSale } from '../services/dataService';
import { getPerformanceReport } from '../services/geminiService';
import { getCurrentUser } from '../services/authService';
import type { SavedSale, PerformanceReport } from '../types';

export default function SalesmanDashboard() {
  const { user, logout } = useAuthStore();
  const {
    transcript,
    summary,
    currentStep,
    sentiment,
    successProbability,
    coachingAlerts,
    updateTranscriptSegment,
    resetCall,
  } = useCallStore();

  const [salesHistory, setSalesHistory] = useState<SavedSale[]>([]);
  const [performanceReport, setPerformanceReport] = useState<PerformanceReport | null>(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [customerName, setCustomerName] = useState<string>('');

  const {
    isRecording,
    isPaused,
    duration,
    audioLevel,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    error,
  } = useAudioRecorder();

  // Load sales history
  useEffect(() => {
    if (user?.id) {
      loadSalesHistory();
    }
  }, [user?.id]);

  // Generate performance report when summary is available
  useEffect(() => {
    if (summary && transcript.length > 0 && !isLoadingReport) {
      generatePerformanceReport();
    }
  }, [summary]);

  const loadSalesHistory = async () => {
    if (user?.id) {
      try {
        const sales = await getRecentSales();
        // Filter for current user's sales
        setSalesHistory(sales.items as any);
      } catch (err) {
        console.error('Failed to load sales history:', err);
      }
    }
  };

  const generatePerformanceReport = async () => {
    setIsLoadingReport(true);
    try {
      // Convert transcript to full text for analysis
      const fullTranscript = transcript
        .map(seg => `${seg.speaker}: ${seg.text}`)
        .join('\n');

      const report = await getPerformanceReport(fullTranscript);
      if (report) {
        setPerformanceReport(report);
      }
    } catch (error) {
      console.error('Error generating performance report:', error);
    } finally {
      setIsLoadingReport(false);
    }
  };

  // Handle ending recording and saving to PocketBase
  const handleEndSession = async () => {
    try {
      console.log('[SalesmanDashboard] Ending session and saving to PocketBase...');
      
      // Get current user
      const currentUser = getCurrentUser();
      if (!currentUser) {
        console.error('No user logged in');
        alert('Error: Not logged in. Please log in again.');
        return;
      }

      // Get session state
      const sessionState = useCallStore.getState();
      
      // Validate we have data to save
      if (!sessionState.transcript || sessionState.transcript.length === 0) {
        console.warn('No transcript to save');
        alert('No conversation recorded. Start recording to save data.');
        return;
      }

      console.log('[SalesmanDashboard] Saving sale with:', {
        salesperson_id: currentUser.id,
        customer_name: customerName || 'Unknown Customer',
        transcript_length: sessionState.transcript.length,
        has_performance_report: !!performanceReport,
      });

      // Save to PocketBase
      await createSale({
        salesperson_id: currentUser.id,
        customer_name: customerName || 'Unknown Customer',
        transcript: sessionState.transcript,
        analysis: {
          current_step: sessionState.currentStep,
          sentiment: sessionState.sentiment,
          coaching_alerts: sessionState.coachingAlerts,
          duration: sessionState.duration,
          summary: sessionState.summary,
        },
        performance_report: performanceReport || undefined,
        success_probability: sessionState.successProbability / 100,
      });

      console.log('✅ Sale session saved to PocketBase successfully');
      
      // Stop recording
      stopRecording();
      
      // Reset session state
      resetCall();
      setPerformanceReport(null);
      setCustomerName('');
      
      // Refresh sales history
      await loadSalesHistory();
      
      // Show success message
      alert('Session saved successfully! ✅');
      
    } catch (error: any) {
      console.error('❌ Failed to save session to PocketBase:', error);
      console.error('Error details:', {
        message: error.message,
        status: error.status,
        response: error.response,
        data: error.data,
      });
      alert(`Failed to save session: ${error.message || 'Unknown error'}. Please try again.`);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold">AI Sales Coach</h1>
                <p className="text-sm text-muted-foreground">Welcome, {user?.name}!</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isRecording && (
                <Badge variant="default" className="animate-pulse">
                  Recording
                </Badge>
              )}
              <ThemeToggleInline />
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="record" className="space-y-6">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-4">
            <TabsTrigger value="record">
              <FileText className="w-4 h-4 mr-2" />
              Record
            </TabsTrigger>
            <TabsTrigger value="insights">
              <BarChart3 className="w-4 h-4 mr-2" />
              Insights
            </TabsTrigger>
            <TabsTrigger value="history">
              <ClipboardList className="w-4 h-4 mr-2" />
              History
            </TabsTrigger>
            <TabsTrigger value="briefing">
              <Sparkles className="w-4 h-4 mr-2" />
              Briefing
            </TabsTrigger>
          </TabsList>

          {/* Recording Tab */}
          <TabsContent value="record" className="space-y-6">
            {error && (
              <Card className="border-destructive bg-destructive/10">
                <CardContent className="pt-6">
                  <p className="text-sm text-destructive">{error}</p>
                </CardContent>
              </Card>
            )}

            <div className="grid lg:grid-cols-3 gap-6">
              {/* Left Column - Recording */}
              <div className="lg:col-span-2 space-y-6">
                {/* Recording Controls */}
                <Card>
                  <CardHeader>
                    <CardTitle>Live Customer Interaction</CardTitle>
                    <CardDescription>
                      Record your conversation to get real-time AI coaching and insights
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Customer Name Input */}
                    {!isRecording && (
                      <div className="space-y-2">
                        <label htmlFor="customer-name" className="text-sm font-medium">
                          Customer Name
                        </label>
                        <input
                          id="customer-name"
                          type="text"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          placeholder="Enter customer name..."
                          className="w-full px-3 py-2 border rounded-md bg-background"
                        />
                      </div>
                    )}
                    
                    <RecordingControls
                      isRecording={isRecording}
                      isPaused={isPaused}
                      duration={duration}
                      onStart={startRecording}
                      onStop={handleEndSession}
                      onPause={pauseRecording}
                      onResume={resumeRecording}
                    />

                    {/* Audio Level */}
                    {isRecording && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex justify-center"
                      >
                        <AudioLevelIndicator level={audioLevel} />
                      </motion.div>
                    )}

                    {/* Waveform */}
                    <AudioWaveform audioLevel={audioLevel} isActive={isRecording && !isPaused} />
                  </CardContent>
                </Card>

                {/* Transcript */}
                {transcript.length > 0 && (
                  <Card>
                    <CardContent className="pt-6">
                      <TranscriptDisplay
                        segments={transcript}
                        isLive={isRecording}
                        onUpdateSegment={updateTranscriptSegment}
                      />
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Right Column - Live Insights */}
              <div className="space-y-6">
                {/* Sales Progress */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Sales Progress</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Success Probability</span>
                        <span className="text-2xl font-bold">{successProbability}%</span>
                      </div>
                      <Progress value={successProbability} className="h-2" />
                    </div>

                    {currentStep && (
                      <div>
                        <span className="text-sm text-muted-foreground">Current Step</span>
                        <p className="font-semibold mt-1">{currentStep}</p>
                      </div>
                    )}

                    <div>
                      <span className="text-sm text-muted-foreground">Sentiment</span>
                      <div className="mt-1">
                        <Badge
                          variant={
                            sentiment === 'Positive'
                              ? 'success'
                              : sentiment === 'Negative'
                              ? 'destructive'
                              : 'default'
                          }
                        >
                          {sentiment}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Coaching Alerts */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Coaching Alerts</CardTitle>
                    <CardDescription>Real-time suggestions</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <CoachingAlertsList alerts={coachingAlerts} />
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Insights Tab */}
          <TabsContent value="insights" className="space-y-6">
            {performanceReport ? (
              <PerformanceReportViewer report={performanceReport} />
            ) : summary ? (
              <Card>
                <CardHeader>
                  <CardTitle>Call Summary</CardTitle>
                  <CardDescription>AI-generated summary of your sales interaction</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="prose dark:prose-invert max-w-none">
                    <p className="text-sm whitespace-pre-wrap">{summary}</p>
                  </div>
                  {isLoadingReport && (
                    <p className="text-sm text-muted-foreground text-center mt-4">
                      Generating detailed performance report...
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground text-center py-8">
                    Complete a recording to see performance insights
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history">
            <SalesHistory sales={salesHistory} onSaleDeleted={loadSalesHistory} />
          </TabsContent>

          {/* Briefing Tab */}
          <TabsContent value="briefing">
            <PrecallBriefing />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
