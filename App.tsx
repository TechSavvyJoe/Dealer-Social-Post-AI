import React, { useState, useCallback, useEffect } from 'react';
import { AppStep, GeneratedPost, StyleOption, ToneOption, DealershipSettings } from './types';
import { ImageInput } from './components/CameraCapture';
import { PostResult } from './components/PostResult';
import { generateSocialPost } from './services/geminiService';
import { Icon } from './components/Icons';
import { SettingsModal } from './components/SettingsModal';
import { loadSettings, saveSettings } from './utils/settings';

const loadingMessages = [
  "Polishing the chrome...",
  "Adding that new car smell...",
  "Finding the perfect filter...",
  "Writing a winning caption...",
  "Warming up the engine...",
  "Consulting with our design AI...",
  "Finalizing the details..."
];

interface PostCustomizerProps {
    imageSrc: string;
    onGenerate: (style: StyleOption, tone: ToneOption, customerName: string) => void;
    onBack: () => void;
    onOpenSettings: () => void;
}

const PostCustomizer: React.FC<PostCustomizerProps> = ({ imageSrc, onGenerate, onBack, onOpenSettings }) => {
    const [customerName, setCustomerName] = useState('');
    const [style, setStyle] = useState<StyleOption>(StyleOption.Modern);
    const [tone, setTone] = useState<ToneOption>(ToneOption.Excited);

    const handleSubmit = () => {
        onGenerate(style, tone, customerName);
    };

    const OptionCard: React.FC<{
      value: StyleOption | ToneOption; 
      label: string; 
      selectedValue: StyleOption | ToneOption; 
      onClick: (value: any) => void;
    }> = ({ value, label, selectedValue, onClick}) => (
        <button
            onClick={() => onClick(value)}
            className={`w-full text-center p-3 border-2 rounded-lg transition-all duration-200 font-semibold text-sm
                ${selectedValue === value 
                    ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg ring-2 ring-indigo-400/50' 
                    : 'bg-white/5 border-white/20 hover:bg-white/10 hover:border-white/30'
            }`}
        >
            {label}
        </button>
    );

    return (
        <div className="w-full max-w-6xl mx-auto p-4 space-y-6 animate-fade-in">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                <div className="flex flex-col items-center space-y-4">
                    <img src={imageSrc} alt="Preview" className="rounded-xl object-contain w-full max-w-lg shadow-2xl border-2 border-white/10" />
                     <div className="w-full max-w-lg grid grid-cols-2 gap-3">
                        <button onClick={onBack} className="flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-3 px-4 rounded-lg hover:bg-white/20 transition-colors">
                            <Icon type="retake" className="w-5 h-5"/>
                            <span>Change Photo</span>
                        </button>
                         <button onClick={onOpenSettings} className="flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-3 px-4 rounded-lg hover:bg-white/20 transition-colors">
                            <Icon type="settings" className="w-5 h-5" />
                            <span>Settings</span>
                        </button>
                    </div>
                </div>
                <div className="bg-white/10 backdrop-blur-lg border border-white/20 p-6 rounded-2xl space-y-6">
                    <div>
                        <label htmlFor="customerName" className="block text-lg font-bold text-white mb-2">
                          1. Customer's Name
                        </label>
                        <input
                          type="text"
                          id="customerName"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          placeholder="(Optional) e.g., Jane"
                          className="w-full bg-slate-800/50 text-white border-2 border-white/20 rounded-md px-4 py-3 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition"
                        />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white mb-2">2. Choose a Style</h3>
                        <div className="grid grid-cols-2 gap-3">
                           {Object.values(StyleOption).map(s => <OptionCard key={s} value={s} label={s} selectedValue={style} onClick={setStyle} />)}
                        </div>
                    </div>
                     <div>
                        <h3 className="text-lg font-bold text-white mb-2">3. Set the Tone</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                           {Object.values(ToneOption).map(t => <OptionCard key={t} value={t} label={t} selectedValue={tone} onClick={setTone} />)}
                        </div>
                    </div>
                    <button 
                        onClick={handleSubmit} 
                        className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold py-4 px-6 rounded-lg hover:scale-105 transition-all duration-300 text-xl shadow-lg hover:shadow-green-500/50">
                        <Icon type="check" className="w-7 h-7" />
                        <span>Generate Post</span>
                    </button>
                </div>
            </div>
        </div>
    );
};


const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.WELCOME);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [generatedPost, setGeneratedPost] = useState<GeneratedPost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<DealershipSettings>({ dealershipName: '' });

  useEffect(() => {
    const loadedSettings = loadSettings();
    if (loadedSettings) {
        setSettings(loadedSettings);
    }
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


  const handleImageSelected = useCallback((image: string) => {
    setSelectedImage(image);
    setStep(AppStep.CUSTOMIZE);
    setError(null);
  }, []);

  const handleGenerate = useCallback(async (style: StyleOption, tone: ToneOption, customerName:string) => {
    if (!selectedImage) return;
    if (!settings.dealershipName) {
        alert("Please set your dealership name in the settings before generating a post.");
        setIsSettingsOpen(true);
        return;
    }
    setStep(AppStep.GENERATING);
    setError(null);
    try {
      const result = await generateSocialPost(selectedImage, style, tone, settings.dealershipName, customerName);
      setGeneratedPost(result);
      setStep(AppStep.RESULT);
    } catch (err) {
      console.error("Failed to generate post:", err);
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to generate your post. Please try again. ${errorMessage}`);
      setStep(AppStep.CUSTOMIZE);
    }
  }, [selectedImage, settings]);

  const handleStartOver = useCallback(() => {
    setGeneratedPost(null);
    setSelectedImage(null);
    setError(null);
    setStep(AppStep.WELCOME);
  }, []);

  const handleBackToCapture = useCallback(() => {
      setSelectedImage(null);
      setError(null);
      setStep(AppStep.CAPTURE);
  }, []);

  const handleSaveSettings = (newSettings: DealershipSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    setIsSettingsOpen(false);
  };

  const renderContent = () => {
    switch (step) {
      case AppStep.WELCOME:
        return (
            <div className="text-center p-8 max-w-4xl mx-auto">
                <h1 className="text-5xl md:text-7xl font-extrabold text-white mb-4 bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-500">
                    Dealership Social AI
                </h1>
                <p className="text-lg text-slate-300 mb-10 max-w-2xl mx-auto">
                    Turn happy customers into viral social media moments. Instantly generate stunning, professional posts right from your phone.
                </p>
                <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
                    <button 
                        onClick={() => setStep(AppStep.CAPTURE)} 
                        className="w-full sm:w-auto bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold text-xl py-4 px-10 rounded-full hover:scale-105 transition-transform duration-300 shadow-lg hover:shadow-indigo-500/50">
                        Get Started
                    </button>
                    <button 
                        onClick={() => setIsSettingsOpen(true)}
                        title="Settings"
                        aria-label="Open settings"
                        className="bg-white/10 border border-white/20 text-white p-4 rounded-full hover:bg-white/20 hover:scale-105 transition-transform duration-300 shadow-lg">
                        <Icon type="settings" className="w-7 h-7" />
                    </button>
                </div>
            </div>
        );
      case AppStep.CAPTURE:
        return (
            <ImageInput onImageSelected={handleImageSelected} onClose={handleStartOver} />
        );
      case AppStep.CUSTOMIZE:
        if (error) {
            return (
              <div className="w-full max-w-2xl mx-auto text-center p-4">
                <div className="mb-4 bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg flex items-center justify-center gap-2">
                  <Icon type="error" className="w-5 h-5"/>
                  <span>{error}</span>
                </div>
                 { selectedImage && <PostCustomizer imageSrc={selectedImage} onGenerate={handleGenerate} onBack={handleBackToCapture} onOpenSettings={() => setIsSettingsOpen(true)} /> }
              </div>
            );
        }
        return selectedImage ? <PostCustomizer imageSrc={selectedImage} onGenerate={handleGenerate} onBack={handleBackToCapture} onOpenSettings={() => setIsSettingsOpen(true)} /> : null;
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
        return generatedPost ? <PostResult post={generatedPost} onStartOver={handleStartOver} /> : null;
      default:
        return null;
    }
  };

  return (
    <main className="min-h-screen w-full text-slate-100 flex flex-col items-center justify-center p-4">
       <div className="fixed top-0 left-0 w-full h-full bg-slate-900 -z-10"></div>
      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
        currentSettings={settings}
      />
      {renderContent()}
    </main>
  );
};

export default App;