import React, { useState, useEffect } from 'react';
import { GeneratedPost, VideoStyle } from '../types';
import { dataUrlToBlob } from '../utils/imageUtils';
import { Icon } from './Icons';
import { ImagePreviewModal } from './ImagePreviewModal';
import { triggerHapticFeedback } from '../utils/haptics';
import { VideoDirectorModal } from './VideoDirectorModal';
import { EditTextModal } from './EditTextModal';

interface PostResultProps {
  post: GeneratedPost;
  onStartOver: () => void;
  onRegenerateImage: () => Promise<void>;
  onEditImage: (prompt: string) => Promise<void>;
  onRegenerateText: () => Promise<void>;
  onEditText: (prompt: string) => Promise<void>;
  onFunMode: () => Promise<void>;
  onAnimatePost: (style: VideoStyle) => Promise<void>;
  onRemoveAnimation: () => void;
  animatedVideoUrl?: string | null;
  error?: string | null;
}

const videoLoadingMessages = [
    "Briefing the AI director...",
    "Setting up the virtual cameras...",
    "Choreographing the animation...",
    "Adding a touch of movie magic...",
    "Rendering the final cut...",
    "Polishing the special effects..."
];

const LoadingOverlay: React.FC<{ message: string }> = React.memo(({ message }) => (
    <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg z-10">
        <svg className="animate-spin h-12 w-12 text-indigo-400 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="text-white font-semibold animate-pulse">{message}</p>
    </div>
));


export const PostResult: React.FC<PostResultProps> = ({ post, onStartOver, onRegenerateImage, onEditImage, onRegenerateText, onEditText, onFunMode, onAnimatePost, onRemoveAnimation, animatedVideoUrl, error }) => {
  const [copied, setCopied] = useState(false);
  
  const [isImageEditing, setIsImageEditing] = useState(false);
  const [imageEditPrompt, setImageEditPrompt] = useState('');
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  
  const [editedText, setEditedText] = useState(post.text);
  const [isTextEditing, setIsTextEditing] = useState(false);
  const [isTextLoading, setIsTextLoading] = useState(false);
  
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isVideoDirectorOpen, setIsVideoDirectorOpen] = useState(false);
  const [animationLoadingMessage, setAnimationLoadingMessage] = useState(videoLoadingMessages[0]);
  
  useEffect(() => {
      setEditedText(post.text);
  }, [post.text]);

  useEffect(() => {
    let interval: number;
    if (isAnimating) {
        interval = window.setInterval(() => {
            setAnimationLoadingMessage(prev => {
                const currentIndex = videoLoadingMessages.indexOf(prev);
                const nextIndex = (currentIndex + 1) % videoLoadingMessages.length;
                return videoLoadingMessages[nextIndex];
            });
        }, 3000);
    }
    return () => clearInterval(interval);
  }, [isAnimating]);

  const handleSave = () => {
    triggerHapticFeedback();
    const link = document.createElement('a');
    if (animatedVideoUrl) {
      link.href = animatedVideoUrl;
      link.download = 'animated-post.mp4';
    } else {
      link.href = post.image;
      link.download = 'social-media-post.jpg';
    }
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const synchronousCopy = (text: string): boolean => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed"; // Prevent scrolling to bottom of page in MS Edge.
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    let success = false;
    try {
      success = document.execCommand("copy");
    } catch (err) {
      console.error("Fallback copy command failed", err);
    }
    document.body.removeChild(textArea);
    return success;
  };

  const handleCopy = async () => {
    triggerHapticFeedback();
    let success = false;
    const textToCopy = editedText;
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        success = true;
      } catch (err) {
        success = synchronousCopy(textToCopy);
      }
    } else {
      success = synchronousCopy(textToCopy);
    }

    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    triggerHapticFeedback();
    const textToShare = editedText;
    synchronousCopy(textToShare); // Copy text to clipboard as a fallback
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);

    try {
      let blob: Blob;
      let fileName: string;
      if (animatedVideoUrl) {
        const response = await fetch(animatedVideoUrl);
        blob = await response.blob();
        fileName = 'animated-post.mp4';
      } else {
        blob = await dataUrlToBlob(post.image);
        fileName = "social-media-post.jpg";
      }

      const file = new File([blob], fileName, { type: blob.type });
      const shareData = {
        title: "New Car Celebration!",
        text: textToShare,
        files: [file],
      };
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        alert("Sharing not supported, but the text is copied to your clipboard!");
      }
    } catch (error) {
       if (error instanceof DOMException && error.name === 'AbortError') {
         console.log('User cancelled the share dialog.');
       } else {
         console.error("Sharing failed:", error);
         alert("Could not open share dialog, but text is copied to your clipboard!");
       }
    }
  };

  const handleImageAction = async (action: () => Promise<void>) => {
      setIsImageLoading(true);
      try {
          await action();
      } finally {
          setIsImageLoading(false);
      }
  };

  const handleAnimateClick = () => {
    triggerHapticFeedback();
    setIsVideoDirectorOpen(true);
  };

  const handleStyleSelected = async (style: VideoStyle) => {
    setIsVideoDirectorOpen(false);
    setIsAnimating(true);
    try {
      await onAnimatePost(style);
    } finally {
      setIsAnimating(false);
    }
  };
  
  const handleTextAction = async (action: () => Promise<void>) => {
      setIsTextLoading(true);
      try {
          await action();
      } finally {
          setIsTextLoading(false);
      }
  };

  const handleTextEditSubmit = async (prompt: string) => {
    await handleTextAction(() => onEditText(prompt));
    setIsTextEditing(false); // Close modal after action completes
  };

  const showLoading = isImageLoading || isAnimating;
  const loadingMessage = isAnimating ? animationLoadingMessage : "Updating Image...";

  return (
    <>
      <ImagePreviewModal 
        isOpen={isPreviewOpen && !animatedVideoUrl}
        onClose={() => setIsPreviewOpen(false)}
        imageSrc={post.image}
      />
      <VideoDirectorModal 
        isOpen={isVideoDirectorOpen}
        onClose={() => setIsVideoDirectorOpen(false)}
        onSelectStyle={handleStyleSelected}
      />
      <EditTextModal 
        isOpen={isTextEditing}
        onClose={() => setIsTextEditing(false)}
        onSubmit={handleTextEditSubmit}
        originalText={post.text}
        isLoading={isTextLoading}
      />
      <div className="w-full max-w-6xl mx-auto p-2 sm:p-4 md:p-6 space-y-6">
        <h2 className="text-3xl sm:text-4xl font-bold text-center text-white">Your Post is Ready!</h2>
        {error && (
          <div className="mb-4 bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg flex items-center justify-center gap-2">
            <Icon type="error" className="w-5 h-5"/>
            <span>{error}</span>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          
          <div className="lg:col-span-3 flex flex-col items-center bg-white/5 p-4 rounded-2xl shadow-2xl space-y-4">
              <div className="relative w-full">
                  {showLoading && <LoadingOverlay message={loadingMessage} />}
                   {animatedVideoUrl ? (
                      <video src={animatedVideoUrl} autoPlay loop muted playsInline className="rounded-lg shadow-2xl w-full object-contain" />
                    ) : (
                      <button onClick={() => { triggerHapticFeedback(); setIsPreviewOpen(true); }} className="w-full block rounded-lg overflow-hidden focus:outline-none focus:ring-4 focus:ring-indigo-500/50" aria-label="Enlarge image">
                        <img src={post.image} alt="Generated social media post" className="rounded-lg shadow-2xl w-full object-contain" />
                      </button>
                    )}
              </div>

              <div className="w-full space-y-3">
                   <div className="space-y-3 sm:space-y-0 sm:grid sm:grid-cols-2 md:grid-cols-4 sm:gap-3">
                      <button onClick={() => { triggerHapticFeedback(); handleImageAction(onRegenerateImage); }} disabled={!!animatedVideoUrl || isAnimating} className="w-full flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-3 px-4 rounded-lg hover:bg-white/20 transition-colors text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed">
                          <Icon type="regenerate" className="w-5 h-5" />
                          <span>Regenerate</span>
                      </button>
                      <button onClick={() => { triggerHapticFeedback(); setIsImageEditing(!isImageEditing); }} disabled={!!animatedVideoUrl || isAnimating} className="w-full flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-3 px-4 rounded-lg hover:bg-white/20 transition-colors text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed">
                          <Icon type="edit" className="w-5 h-5" />
                          <span>{isImageEditing ? 'Cancel' : 'Edit'}</span>
                      </button>
                      <button onClick={() => { triggerHapticFeedback(); handleImageAction(onFunMode); }} disabled={!!animatedVideoUrl || isAnimating} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-3 px-4 rounded-lg hover:scale-105 transition-transform duration-300 text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed">
                          <Icon type="sparkles" className="w-5 h-5" />
                          <span>Fun Mode</span>
                      </button>
                       {animatedVideoUrl ? (
                          <button onClick={() => { triggerHapticFeedback(); onRemoveAnimation(); }} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-red-500 to-orange-500 text-white font-bold py-3 px-4 rounded-lg hover:scale-105 transition-transform duration-300 text-sm sm:text-base">
                              <Icon type="close" className="w-5 h-5" />
                              <span>Remove Animation</span>
                          </button>
                      ) : (
                          <button onClick={handleAnimateClick} disabled={isAnimating} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-teal-400 to-blue-500 text-white font-bold py-3 px-4 rounded-lg hover:scale-105 transition-transform duration-300 text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed">
                              <Icon type="movie" className="w-5 h-5" />
                              <span>Animate Post</span>
                          </button>
                      )}
                  </div>
                  {isImageEditing && !animatedVideoUrl && (
                      <div className="space-y-2 p-3 bg-slate-800/50 rounded-lg animate-fade-in">
                          <textarea value={imageEditPrompt} onChange={(e) => setImageEditPrompt(e.target.value)} placeholder="e.g., Make the text gold..." className="w-full bg-slate-800/50 text-white border-2 border-white/20 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition text-sm" rows={2}/>
                          <button onClick={() => { triggerHapticFeedback(); handleImageAction(() => onEditImage(imageEditPrompt)).then(() => setIsImageEditing(false)); }} disabled={!imageEditPrompt.trim()} className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold py-2 px-4 rounded-lg hover:scale-105 transition-transform duration-300 disabled:opacity-50 disabled:cursor-not-allowed">
                              Submit Edit
                          </button>
                      </div>
                  )}
              </div>
               <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button onClick={handleSave} className="flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold py-3 px-4 rounded-lg hover:scale-105 transition-transform duration-300 text-base">
                      <Icon type="download" /><span>{animatedVideoUrl ? 'Save Video' : 'Save Image'}</span>
                  </button>
                   <button onClick={handleShare} className="flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold py-3 px-4 rounded-lg hover:scale-105 transition-transform duration-300 text-base">
                      <Icon type="share"/><span>{animatedVideoUrl ? 'Share Video' : 'Share Post'}</span>
                  </button>
               </div>
          </div>
          
          <div className="lg:col-span-2 bg-white/10 backdrop-blur-lg border border-white/20 p-4 lg:p-6 rounded-2xl flex flex-col">
              <h3 className="text-xl font-semibold mb-3 text-white">Generated Social Post</h3>
              <div className="relative mb-4 flex-grow">
                  {isTextLoading && <LoadingOverlay message="Updating Text..." />}
                  <textarea 
                    value={editedText}
                    onChange={(e) => setEditedText(e.target.value)}
                    disabled={isTextLoading}
                    className="w-full h-40 lg:h-auto lg:flex-grow bg-slate-800/50 text-slate-300 p-4 rounded-md text-sm resize-none border-2 border-transparent focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400 outline-none transition"
                  />
              </div>
               <button onClick={handleCopy} className="w-full flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-3 px-4 rounded-lg hover:bg-white/20 transition-colors">
                  <Icon type={copied ? 'check' : 'copy'} className="w-5 h-5" />
                  <span>{copied ? 'Copied!' : 'Copy Text'}</span>
              </button>
              <div className="border-t border-white/10 my-4"></div>
              <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                      <button onClick={() => { triggerHapticFeedback(); handleTextAction(onRegenerateText); }} className="flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-2 px-4 rounded-lg hover:bg-white/20 transition-colors text-sm">
                          <Icon type="regenerate" className="w-4 h-4" /><span>Regenerate</span>
                      </button>
                      <button 
                          onClick={() => { triggerHapticFeedback(); setIsTextEditing(true); }} 
                          className="flex items-center justify-center gap-2 text-white font-bold py-2 px-4 rounded-lg transition-all duration-300 text-sm bg-gradient-to-r from-sky-500 to-indigo-500 hover:scale-105"
                      >
                          <Icon type="edit" className="w-4 h-4" /><span>Edit with AI</span>
                      </button>
                  </div>
              </div>
          </div>
        </div>
        
        <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row justify-center items-center gap-4">
          <button onClick={() => { triggerHapticFeedback(); onStartOver(); }} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-3 px-8 rounded-full hover:bg-white/20 transition-colors text-base sm:text-lg">
             <Icon type="restart" className="w-6 h-6"/>
             <span>Create Another</span>
          </button>
        </div>
      </div>
    </>
  );
};