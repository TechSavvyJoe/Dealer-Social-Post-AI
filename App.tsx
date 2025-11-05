import React, { useState, useCallback, useEffect, ReactNode } from 'react';
import { AppStep, GeneratedPost, StyleOption, ToneOption, DealershipSettings, TemplateOption, VideoStyle, Dealer } from './types';
import { ImageInput } from './components/CameraCapture';
import { PostResult } from './components/PostResult';
import { generateSocialPost, editSocialPostImage, generateSocialPostText, editSocialPostText, generateFunSocialPostImage, generatePostVideo } from './services/geminiService';
import { Icon } from './components/Icons';
import { POST_TEMPLATES } from './components/templates';
import { triggerHapticFeedback } from './utils/haptics';
import { LoginScreen } from './components/LoginScreen';
import { findDealer } from './services/database';
import { urlToDataUrl } from './utils/imageUtils';
import { Header } from './components/Header';
import { AdminDashboard } from './components/AdminDashboard';


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
    dealershipName: string;
}

const Accordion: React.FC<{ title: string; children: ReactNode; defaultOpen?: boolean }> = React.memo(({ title, children, defaultOpen = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

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
    <button onClick={() => { triggerHapticFeedback(); onClick(value); }} className={`w-full text-center p-2 border-2 rounded-lg transition-all duration-200 font-semibold text-sm flex items-center justify-center h-16 ${selectedValue === value ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg' : 'bg-white/5 border-white/20 hover:bg-white/10'}`}>
        {label}
    </button>
));


const PostCustomizer: React.FC<PostCustomizerProps> = ({ imageSrc, onGenerate, onBack, dealershipName }) => {
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="flex flex-col items-center space-y-4">
                    <img src={imageSrc} alt="Preview" className="rounded-xl object-contain w-full max-w-lg shadow-2xl border-2 border-white/10" />
                     <div className="w-full max-w-lg">
                        <button onClick={() => { triggerHapticFeedback(); onBack(); }} className="w-full flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-3 px-4 rounded-lg hover:bg-white/20 transition-colors">
                            <Icon type="retake" className="w-5 h-5"/><span>Change Photo</span>
                        </button>
                    </div>
                </div>
                <div className="bg-white/10 backdrop-blur-lg border border-white/20 p-4 sm:p-6 rounded-2xl space-y-4">
                    <div>
                        <label className="block text-base sm:text-lg font-bold text-white mb-2">1. Customer's Name</label>
                        <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="(Optional) e.g., Jane" className="w-full bg-slate-800/50 text-white border-2 border-white/20 rounded-md px-4 py-3 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition"/>
                    </div>
                    
                    <Accordion title="2. Visual Style" defaultOpen={true}>
                        <div className="grid grid-cols-2 gap-3">{Object.values(StyleOption).map(s => <OptionCard key={s} value={s} label={s} selectedValue={style} onClick={setStyle} />)}</div>
                    </Accordion>
                    
                    <Accordion title="3. Caption & Image Text">
                        <div className="space-y-4">
                          <div className="grid grid-cols-3 gap-3">{Object.values(CaptionSource).map(s => <OptionCard key={s} value={s} label={s} selectedValue={captionSource} onClick={setCaptionSource} />)}</div>
                          
                          {captionSource === CaptionSource.AI && (
                              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-800/30 rounded-lg animate-fade-in">
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
  const [step, setStep] = useState<AppStep>(AppStep.LOGIN);
  const [displayedStep, setDisplayedStep] = useState(step);
  const [animationClass, setAnimationClass] = useState('animate-fade-in');

  const [currentDealer, setCurrentDealer] = useState<Dealer | null>(null);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [generatedPost, setGeneratedPost] = useState<GeneratedPost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

  const [lastGenerationParams, setLastGenerationParams] = useState<{
    style: StyleOption;
    tone: ToneOption;
    customerName: string;
    customText?: string;
  } | null>(null);

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

  const handleLogin = async (dealerId: string): Promise<boolean> => {
    const dealer = await findDealer(dealerId);

    if (dealer) {
        if (dealer.logo && dealer.logo.startsWith('http')) {
            try {
                const logoDataUrl = await urlToDataUrl(dealer.logo);
                dealer.logo = logoDataUrl;
            } catch (error) {
                console.error(`Failed to fetch and convert dealer logo from URL: ${dealer.logo}`, error);
                dealer.logo = undefined;
            }
        }

        setCurrentDealer(dealer);
        if (dealer.id === '0000') {
            setStep(AppStep.ADMIN);
        } else {
            setStep(AppStep.CAPTURE);
        }
        setError(null);
        return true;
    }
    return false;
  };

  const handleLogout = () => {
      triggerHapticFeedback();
      setCurrentDealer(null);
      setSelectedImage(null);
      setGeneratedPost(null);
      setError(null);
      setStep(AppStep.LOGIN);
  };

  const handleGenerate = useCallback(async (style: StyleOption, tone: ToneOption, customerName:string, customText?: string) => {
    if (!selectedImage || !currentDealer) return;
    
    setStep(AppStep.GENERATING);
    setError(null);
    setLastGenerationParams({ style, tone, customerName, customText });
    try {
      const result = await generateSocialPost(selectedImage, style, tone, currentDealer.name, customerName, currentDealer.logo, customText);
      setGeneratedPost(result);
      setStep(AppStep.RESULT);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to generate your post. Please try again. ${errorMessage}`);
      setStep(AppStep.CUSTOMIZE);
    }
  }, [selectedImage, currentDealer]);
  
  const handleRegenerateImage = useCallback(async () => {
    if (!selectedImage || !lastGenerationParams || !currentDealer) return;
    setError(null);
    try {
      const result = await generateSocialPost(
        selectedImage, lastGenerationParams.style, lastGenerationParams.tone, 
        currentDealer.name, lastGenerationParams.customerName, currentDealer.logo,
        lastGenerationParams.customText || generatedPost?.text // Keep the current text
      );
      setGeneratedPost(result);
    } catch (err)
 {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to regenerate image. ${errorMessage}`);
    }
  }, [selectedImage, lastGenerationParams, currentDealer, generatedPost]);
  
  const handleEditImage = useCallback(async (editPrompt: string) => {
    if (!generatedPost?.image || !editPrompt.trim() || !currentDealer) return;
    setError(null);
    try {
        const newImage = await editSocialPostImage(generatedPost.image, editPrompt, currentDealer.name, currentDealer.logo);
        setGeneratedPost(prev => prev ? { ...prev, image: newImage } : null);
    } catch(err) {
        const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
        setError(`Failed to apply image edits. ${errorMessage}`);
    }
  }, [generatedPost, currentDealer]);

  const handleFunMode = useCallback(async () => {
    if (!selectedImage || !currentDealer) return;
    setError(null);
    try {
        // Use the original selected image for Fun Mode for a clean slate
        const newImage = await generateFunSocialPostImage(selectedImage, currentDealer.name, currentDealer.logo);
        setGeneratedPost(prev => prev ? { ...prev, image: newImage } : { image: newImage, text: prev?.text || "Congratulations!" });
    } catch(err) {
        const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
        setError(`Failed to generate fun image. ${errorMessage}`);
    }
  }, [selectedImage, currentDealer]);

  const handleRegenerateText = useCallback(async () => {
    if (!selectedImage || !lastGenerationParams || !currentDealer) return;
    setError(null);
    try {
      const newText = await generateSocialPostText(
        selectedImage,
        lastGenerationParams.tone,
        currentDealer.name,
        lastGenerationParams.customerName,
        true
      );
      setGeneratedPost(prev => prev ? { ...prev, text: newText } : null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to regenerate text. ${errorMessage}`);
    }
  }, [selectedImage, lastGenerationParams, currentDealer]);

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

  const handleGenerateVideo = useCallback(async (style: VideoStyle): Promise<string> => {
    if (!generatedPost?.image) {
        throw new Error("Cannot generate video without an image.");
    }
    setError(null);

    // Check for API key selection for Veo models, a requirement for video generation.
    // @ts-ignore - aistudio is globally available in this environment
    if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        // @ts-ignore
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
            // @ts-ignore
            if (typeof window.aistudio.openSelectKey === 'function') {
                alert("Video generation requires a personal API key due to processing costs. Please select your key.\n\nFor more info on billing, visit: ai.google.dev/gemini-api/docs/billing");
                // @ts-ignore
                await window.aistudio.openSelectKey();
                // After this, we assume the key is selected and proceed. Errors will be caught below.
            } else {
                 const errMsg = "Video generation is not available. Could not find key selection utility.";
                 setError(errMsg);
                 throw new Error(errMsg);
            }
        }
    }

    try {
        const videoUrl = await generatePostVideo(generatedPost.image, style);
        return videoUrl;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      // Handle the specific error for an invalid API key selection.
      if (errorMessage.includes("Requested entity was not found")) {
         setError("There was an issue with your selected API key. Please try generating the video again.");
         // @ts-ignore
         if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
            // @ts-ignore
            await window.aistudio.openSelectKey();
         }
      } else {
        setError(`Failed to generate video. ${errorMessage}`);
      }
      throw err; // Re-throw to be caught by the caller in PostResult
    }
  }, [generatedPost]);


  const handleStartOver = useCallback(() => {
    setGeneratedPost(null);
    setSelectedImage(null);
    setError(null);
    setLastGenerationParams(null);
    setStep(AppStep.CAPTURE);
  }, []);

  const handleBackToCapture = useCallback(() => {
      setSelectedImage(null);
      setError(null);
      setStep(AppStep.CAPTURE);
  }, []);

  const renderContent = () => {
    switch (displayedStep) {
      case AppStep.LOGIN:
        return <LoginScreen onLogin={handleLogin} />;
      case AppStep.ADMIN:
        return <AdminDashboard />;
      case AppStep.CAPTURE:
        return <ImageInput onImageSelected={handleImageSelected} onClose={handleStartOver} />;
      case AppStep.CUSTOMIZE:
        const customizerProps = {
            imageSrc: selectedImage!, 
            onGenerate: handleGenerate, 
            onBack: handleBackToCapture, 
            dealershipName: currentDealer!.name
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
          <div className="text-center p-8 flex flex-col items-center justify-center h-full">
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
                                onGenerateVideo={handleGenerateVideo}
                                error={error} /> : null;
      default:
        return null;
    }
  };

  const isCenteredStep = displayedStep === AppStep.LOGIN || displayedStep === AppStep.GENERATING;
  const layoutClasses = isCenteredStep
    ? 'h-full justify-center'
    : 'justify-start pt-4 sm:pt-8';

  return (
    <main className="h-screen w-full text-slate-100 flex flex-col">
      {currentDealer && <Header dealer={currentDealer} onLogout={handleLogout} />}
      <div className={`w-full flex flex-col items-center flex-grow p-4 ${animationClass} ${layoutClasses}`}>
        {renderContent()}
      </div>
    </main>
  );
};

export default App;