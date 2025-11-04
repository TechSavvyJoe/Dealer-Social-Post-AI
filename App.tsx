import React, { useState, useCallback, useEffect, ReactNode } from 'react';
import { AppStep, GeneratedPost, StyleOption, ToneOption, DealershipSettings, TemplateOption, VideoStyle } from './types';
import { ImageInput } from './components/CameraCapture';
import { PostResult } from './components/PostResult';
import { generateSocialPost, editSocialPostImage, generateSocialPostText, editSocialPostText, generateFunSocialPostImage, generateAnimatedPost } from './services/geminiService';
import { Icon } from './components/Icons';
import { SettingsModal } from './components/SettingsModal';
import { loadSettings, saveSettings } from './utils/settings';
import { POST_TEMPLATES } from './components/templates';
import { triggerHapticFeedback } from './utils/haptics';
import { Logo } from './components/Logo';

const loadingMessages = [
  "Polishing the chrome...",
  "Adding that new car smell...",
  "Finding the perfect filter...",
  "Writing a winning caption...",
  "Warming up the engine...",
  "Consulting with our design AI...",
  "Applying your edits...",
  "Finalizing the details..."
];

enum CaptionSource {
    AI = "AI Generated",
    TEMPLATE = "Use a Template",
    CUSTOM = "Write My Own"
}

interface PostCustomizerProps {
    imageSrc: string;
    onGenerate: (style: StyleOption, tone: ToneOption, customerName: string, customText?: string) => void;
    onBack: () => void;
    onOpenSettings: () => void;
    dealershipName: string;
}

const Accordion: React.FC<{ title: string; children: ReactNode; startOpen?: boolean; }> = React.memo(({ title, children, startOpen = false }) => {
    const [isOpen, setIsOpen] = useState(startOpen);

    const toggleAccordion = () => {
        triggerHapticFeedback();
        setIsOpen(!isOpen);
    }

    return (
        <div className="bg-white/5 border border-white/20 rounded-xl overflow-hidden transition-shadow duration-300 hover:shadow-lg">
            <button
                onClick={toggleAccordion}
                className="w-full flex justify-between items-center p-4 text-left font-bold text-white text-base sm:text-lg"
                aria-expanded={isOpen}
            >
                <span>{title}</span>
                <svg
                    className={`w-5 h-5 transform transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            <div
                className={`transition-all duration-300 ease-in-out grid`}
                style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
            >
                <div className="overflow-hidden">
                    <div className="p-4 pt-0">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
});

const OptionCard: React.FC<{ value: any; label: string; selectedValue: any; onClick: (value: any) => void;}> = React.memo(({ value, label, selectedValue, onClick}) => (
    <button onClick={() => { triggerHapticFeedback(); onClick(value); }} className={`w-full text-center p-3 border-2 rounded-lg transition-all duration-200 font-semibold text-sm ${selectedValue === value ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg' : 'bg-white/5 border-white/20 hover:bg-white/10'}`}>
        {label}
    </button>
));


const PostCustomizer: React.FC<PostCustomizerProps> = ({ imageSrc, onGenerate, onBack, onOpenSettings, dealershipName }) => {
    const [customerName, setCustomerName] = useState('');
    const [style, setStyle] = useState<StyleOption>(StyleOption.Modern);
    const [tone, setTone] = useState<ToneOption>(ToneOption.Excited);
    const [captionSource, setCaptionSource] = useState<CaptionSource>(CaptionSource.AI);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>(POST_TEMPLATES[0].id);
    const [customMessage, setCustomMessage] = useState('');

    const handleSubmit = () => {
        triggerHapticFeedback();
        let postContent: string | undefined = undefined;
        if (captionSource === CaptionSource.TEMPLATE) {
            const selectedTemplate = POST_TEMPLATES.find(t => t.id === selectedTemplateId);
            if (selectedTemplate) {
                postContent = selectedTemplate.content
                    .replace(/\[Customer Name\]/g, customerName.trim() || 'our amazing customer')
                    .replace(/\[Dealership Name\]/g, dealershipName);
            }
        } else if (captionSource === CaptionSource.CUSTOM) {
            postContent = customMessage;
        }
        onGenerate(style, tone, customerName, postContent);
    };

    return (
        <div className="w-full max-w-6xl mx-auto p-2 sm:p-4 space-y-6">
            { !dealershipName && (
                <div className="w-full bg-yellow-900/50 border border-yellow-700 text-yellow-300 px-4 py-3 rounded-lg flex items-center justify-between gap-4 animate-fade-in">
                    <div className="flex items-center gap-3">
                        <Icon type="error" className="w-6 h-6 text-yellow-400"/>
                        <span className="font-semibold">Your dealership name is not set!</span>
                    </div>
                    <button onClick={() => { triggerHapticFeedback(); onOpenSettings(); }} className="bg-yellow-600/50 text-white font-bold py-1 px-3 rounded-md hover:bg-yellow-600/80 text-sm transition-colors whitespace-nowrap">
                        Set Name
                    </button>
                </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <div className="flex flex-col items-center space-y-4">
                    <img src={imageSrc} alt="Preview" className="rounded-xl object-contain w-full max-w-lg shadow-2xl border-2 border-white/10" />
                     <div className="w-full max-w-lg grid grid-cols-2 gap-3">
                        <button onClick={() => { triggerHapticFeedback(); onBack(); }} className="flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-3 px-4 rounded-lg hover:bg-white/20 transition-colors">
                            <Icon type="retake" className="w-5 h-5"/><span>Change Photo</span>
                        </button>
                         <button onClick={() => { triggerHapticFeedback(); onOpenSettings(); }} className="flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-3 px-4 rounded-lg hover:bg-white/20 transition-colors">
                            <Icon type="settings" className="w-5 h-5" /><span>Settings</span>
                        </button>
                    </div>
                </div>
                <div className="bg-white/10 backdrop-blur-lg border border-white/20 p-4 sm:p-6 rounded-2xl space-y-4">
                    <div>
                        <label className="block text-base sm:text-lg font-bold text-white mb-2">1. Customer's Name</label>
                        <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="(Optional) e.g., Jane" className="w-full bg-slate-800/50 text-white border-2 border-white/20 rounded-md px-4 py-3 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition"/>
                    </div>
                    
                    <Accordion title="2. Visual Style" startOpen={true}>
                        <div className="grid grid-cols-2 gap-3">{Object.values(StyleOption).map(s => <OptionCard key={s} value={s} label={s} selectedValue={style} onClick={setStyle} />)}</div>
                    </Accordion>
                    
                    <Accordion title="3. Caption & Image Text">
                        <div className="space-y-4">
                          <div className="grid grid-cols-3 gap-3">{Object.values(CaptionSource).map(s => <OptionCard key={s} value={s} label={s} selectedValue={captionSource} onClick={setCaptionSource} />)}</div>
                          
                          {captionSource === CaptionSource.AI && (
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3 bg-slate-800/30 rounded-lg animate-fade-in">
                                  {Object.values(ToneOption).map(t => <OptionCard key={t} value={t} label={t} selectedValue={tone} onClick={setTone} />)}
                              </div>
                          )}
                          {captionSource === CaptionSource.TEMPLATE && (
                             <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} className="w-full bg-slate-800/50 text-white border-2 border-white/20 rounded-md px-4 py-3 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition animate-fade-in">
                               {POST_TEMPLATES.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
                             </select>
                          )}
                          {captionSource === CaptionSource.CUSTOM && (
                              <div className="p-3 bg-slate-800/30 rounded-lg animate-fade-in">
                                  <textarea 
                                      value={customMessage} 
                                      onChange={(e) => setCustomMessage(e.target.value)} 
                                      placeholder="Write your own message for the image..."
                                      className="w-full bg-slate-800/50 text-white border-2 border-white/20 rounded-md px-4 py-3 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition h-24 resize-none"
                                  />
                              </div>
                          )}
                        </div>
                    </Accordion>

                    <button onClick={handleSubmit} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold py-3 px-6 rounded-lg hover:scale-105 transition-all duration-300 text-lg sm:text-xl shadow-lg hover:shadow-green-500/50">
                        <Icon type="check" className="w-6 sm:w-7 h-6 sm:h-7" /><span>Generate Post</span>
                    </button>
                </div>
            </div>
        </div>
    );
};


const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.WELCOME);
  const [displayedStep, setDisplayedStep] = useState(step);
  const [animationClass, setAnimationClass] = useState('animate-fade-in');

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [generatedPost, setGeneratedPost] = useState<GeneratedPost | null>(null);
  const [animatedVideoUrl, setAnimatedVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<DealershipSettings>({ dealershipName: '' });
  const [lastGenerationParams, setLastGenerationParams] = useState<{
    style: StyleOption;
    tone: ToneOption;
    customerName: string;
    customText?: string;
  } | null>(null);

  // Load dealership settings from local storage on initial app load to persist them across sessions.
  useEffect(() => {
    const loadedSettings = loadSettings();
    if (loadedSettings) setSettings(loadedSettings);
  }, []);

  useEffect(() => {
    let intervalId: number;
    if (step === AppStep.GENERATING) {
      intervalId = window.setInterval(() => {
        setLoadingMessageIndex((prevIndex) => (prevIndex + 1) % loadingMessages.length);
      }, 2500);
    }
    return () => window.clearInterval(intervalId);
  }, [step]);

  useEffect(() => {
    if (step !== displayedStep) {
      setAnimationClass('animate-fade-out');
      const timer = setTimeout(() => {
        setDisplayedStep(step);
        setAnimationClass('animate-fade-in');
      }, 500); // Must match animation duration
      return () => clearTimeout(timer);
    }
  }, [step, displayedStep]);


  const handleImageSelected = useCallback((image: string) => {
    setSelectedImage(image);
    setStep(AppStep.CUSTOMIZE);
    setError(null);
  }, []);

  const handleGenerate = useCallback(async (style: StyleOption, tone: ToneOption, customerName:string, customText?: string) => {
    if (!selectedImage) return;
    if (!settings.dealershipName) {
        // The new UI provides a non-blocking warning, but this alert remains as a final backstop.
        alert("Please set your dealership name in the settings before generating a post.");
        setIsSettingsOpen(true);
        return;
    }
    setStep(AppStep.GENERATING);
    setError(null);
    setLastGenerationParams({ style, tone, customerName, customText });
    try {
      const result = await generateSocialPost(selectedImage, style, tone, settings.dealershipName, customerName, settings.dealershipLogo, customText);
      setGeneratedPost(result);
      setStep(AppStep.RESULT);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to generate your post. Please try again. ${errorMessage}`);
      setStep(AppStep.CUSTOMIZE);
    }
  }, [selectedImage, settings]);
  
  const handleRegenerateImage = useCallback(async () => {
    if (!selectedImage || !lastGenerationParams) return;
    setError(null);
    try {
      const result = await generateSocialPost(
        selectedImage, lastGenerationParams.style, lastGenerationParams.tone, 
        settings.dealershipName, lastGenerationParams.customerName, settings.dealershipLogo,
        lastGenerationParams.customText || generatedPost?.text // Keep the current text
      );
      setGeneratedPost(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to regenerate image. ${errorMessage}`);
    }
  }, [selectedImage, lastGenerationParams, settings, generatedPost]);
  
  const handleEditImage = useCallback(async (editPrompt: string) => {
    if (!generatedPost?.image || !editPrompt.trim()) return;
    setError(null);
    try {
        const newImage = await editSocialPostImage(generatedPost.image, editPrompt, settings.dealershipName, settings.dealershipLogo);
        setGeneratedPost(prev => prev ? { ...prev, image: newImage } : null);
    } catch(err) {
        const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
        setError(`Failed to apply image edits. ${errorMessage}`);
    }
  }, [generatedPost, settings]);

  const handleFunMode = useCallback(async () => {
    if (!selectedImage) return;
    setError(null);
    try {
        // Use the original selected image for Fun Mode for a clean slate
        const newImage = await generateFunSocialPostImage(selectedImage, settings.dealershipName, settings.dealershipLogo);
        setGeneratedPost(prev => prev ? { ...prev, image: newImage } : { image: newImage, text: prev?.text || "Congratulations!" });
    } catch(err) {
        const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
        setError(`Failed to generate fun image. ${errorMessage}`);
    }
  }, [selectedImage, settings]);

  const handleAnimatePost = useCallback(async (style: VideoStyle) => {
    if (!generatedPost?.image) return;
    setError(null);

    let isFirstAttempt = true;

    const attemptGeneration = async () => {
        try {
            const hasKey = await (window as any).aistudio.hasSelectedApiKey();
            if (!hasKey) {
                alert("Video generation requires an API key from a Google Cloud project with billing enabled. Please select a project to continue.\n\nFor more info on billing, visit:\nai.google.dev/gemini-api/docs/billing");
                await (window as any).aistudio.openSelectKey();
            }
            
            const videoUrl = await generateAnimatedPost(generatedPost.image, style);
            setAnimatedVideoUrl(videoUrl);
            
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            const isKeyError = errorMessage.includes("API key not valid") || errorMessage.includes("Requested entity was not found");
            
            if (isKeyError && isFirstAttempt) {
                isFirstAttempt = false;
                alert("Your selected API key appears to be invalid or lacks permissions. Please select a different project, and we will automatically retry.");
                await (window as any).aistudio.openSelectKey();
                await attemptGeneration();
            } else {
                const finalMessage = isKeyError 
                    ? `Animation failed after retry. Please check your API key and project settings. Error: ${errorMessage}`
                    : `Failed to create animation. Please try again. ${errorMessage}`;
                setError(finalMessage);
            }
        }
    };

    await attemptGeneration();

  }, [generatedPost]);

  const handleRemoveAnimation = useCallback(() => {
    if (animatedVideoUrl) {
        URL.revokeObjectURL(animatedVideoUrl);
    }
    setAnimatedVideoUrl(null);
    setError(null);
  }, [animatedVideoUrl]);
  
  const handleRegenerateText = useCallback(async () => {
    if (!selectedImage || !lastGenerationParams) return;
    setError(null);
    try {
      const newText = await generateSocialPostText(
        selectedImage,
        lastGenerationParams.tone,
        settings.dealershipName,
        lastGenerationParams.customerName
      );
      setGeneratedPost(prev => prev ? { ...prev, text: newText } : null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to regenerate text. ${errorMessage}`);
    }
  }, [selectedImage, lastGenerationParams, settings]);

  const handleEditText = useCallback(async (editPrompt: string) => {
    if (!generatedPost?.text || !editPrompt.trim() || !lastGenerationParams) return;
    setError(null);
    try {
      const newText = await editSocialPostText(
        generatedPost.text,
        editPrompt,
        lastGenerationParams.tone
      );
      setGeneratedPost(prev => prev ? { ...prev, text: newText } : null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to edit text. ${errorMessage}`);
    }
  }, [generatedPost, lastGenerationParams]);


  const handleStartOver = useCallback(() => {
    setGeneratedPost(null);
    setSelectedImage(null);
    setError(null);
    setLastGenerationParams(null);
    if (animatedVideoUrl) {
        URL.revokeObjectURL(animatedVideoUrl);
    }
    setAnimatedVideoUrl(null);
    setStep(AppStep.WELCOME);
  }, [animatedVideoUrl]);

  const handleBackToCapture = useCallback(() => {
      setSelectedImage(null);
      setError(null);
      setStep(AppStep.CAPTURE);
  }, []);

  const handleSaveSettings = useCallback((newSettings: DealershipSettings) => {
    setSettings(newSettings);
    // Persist the new settings to local storage.
    saveSettings(newSettings);
    setIsSettingsOpen(false);
  }, []);

  const renderContent = () => {
    switch (displayedStep) {
      case AppStep.WELCOME:
        return (
            <div className="text-center p-8 max-w-4xl mx-auto">
                <Logo className="w-full max-w-lg h-auto mx-auto mb-12" />
                <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
                    <button onClick={() => { triggerHapticFeedback(); setStep(AppStep.CAPTURE); }} className="w-full sm:w-auto bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold text-lg sm:text-xl py-3 px-8 sm:py-4 sm:px-10 rounded-full hover:scale-105 transition-transform duration-300 shadow-lg hover:shadow-indigo-500/50">
                        Get Started
                    </button>
                    <button onClick={() => { triggerHapticFeedback(); setIsSettingsOpen(true); }} title="Settings" aria-label="Open settings" className="bg-white/10 border border-white/20 text-white p-4 rounded-full hover:bg-white/20 hover:scale-105 transition-transform duration-300 shadow-lg">
                        <Icon type="settings" className="w-7 h-7" />
                    </button>
                </div>
            </div>
        );
      case AppStep.CAPTURE:
        return <ImageInput onImageSelected={handleImageSelected} onClose={handleStartOver} />;
      case AppStep.CUSTOMIZE:
        const customizerProps = {
            imageSrc: selectedImage!, 
            onGenerate: handleGenerate, 
            onBack: handleBackToCapture, 
            onOpenSettings: () => setIsSettingsOpen(true),
            dealershipName: settings.dealershipName
        };
        if (error) {
            return (
              <div className="w-full max-w-6xl mx-auto text-center p-4">
                <div className="mb-4 bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg flex items-center justify-center gap-2">
                  <Icon type="error" className="w-5 h-5"/>
                  <span>{error}</span>
                </div>
                 { selectedImage && <PostCustomizer {...customizerProps} /> }
              </div>
            );
        }
        return selectedImage ? <PostCustomizer {...customizerProps} /> : null;
      case AppStep.GENERATING:
        return (
          <div className="text-center p-8 flex flex-col items-center justify-center">
            <svg className="animate-spin h-20 w-20 text-indigo-400 mb-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <h2 className="text-3xl font-bold text-white mb-4 animate-pulse">Crafting Your Masterpiece...</h2>
            <p className="text-indigo-300 text-lg transition-opacity duration-500 h-6">
              {loadingMessages[loadingMessageIndex]}
            </p>
          </div>
        );
      case AppStep.RESULT:
        return generatedPost ? <PostResult 
                                post={generatedPost} 
                                onStartOver={handleStartOver} 
                                onRegenerateImage={handleRegenerateImage} 
                                onEditImage={handleEditImage} 
                                onRegenerateText={handleRegenerateText}
                                onEditText={handleEditText}
                                onFunMode={handleFunMode}
                                onAnimatePost={handleAnimatePost}
                                onRemoveAnimation={handleRemoveAnimation}
                                animatedVideoUrl={animatedVideoUrl}
                                error={error} /> : null;
      default:
        return null;
    }
  };

  const isCenteredStep = displayedStep === AppStep.WELCOME || displayedStep === AppStep.GENERATING || displayedStep === AppStep.CAPTURE;
  const layoutClasses = isCenteredStep
    ? 'h-full justify-center'
    : 'justify-start pt-4 sm:pt-8';

  return (
    <main className="h-screen w-full text-slate-100 flex flex-col p-4">
      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
        currentSettings={settings}
      />
      <div key={displayedStep} className={`w-full flex flex-col items-center flex-grow ${animationClass} ${layoutClasses}`}>
        {renderContent()}
      </div>
    </main>
  );
};

export default App;