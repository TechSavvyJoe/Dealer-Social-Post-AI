import React, { useState, useEffect } from 'react';
import { GeneratedPost, VideoStyle } from '../types';
import { dataUrlToBlob } from '../utils/imageUtils';
import { Icon } from './Icons';
import { ImagePreviewModal } from './ImagePreviewModal';
import { triggerHapticFeedback } from '../utils/haptics';
import { EditTextModal } from './EditTextModal';
import { VideoDirectorModal } from './VideoDirectorModal';

interface PostResultProps {
  post: GeneratedPost;
  onStartOver: () => void;
  onRegenerateImage: () => Promise<void>;
  onEditImage: (prompt: string) => Promise<void>;
  onRegenerateText: () => Promise<void>;
  onEditText: (prompt: string) => Promise<void>;
  onFunMode: () => Promise<void>;
  onGenerateVideo: (style: VideoStyle) => Promise<string>;
  error?: string | null;
}

const LoadingOverlay: React.FC<{ message: string }> = React.memo(({ message }) => (
    <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg z-10">
        <svg className="animate-spin h-12 w-12 text-indigo-400 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="text-white font-semibold animate-pulse">{message}</p>
    </div>
));


export const PostResult: React.FC<PostResultProps> = ({ post, onStartOver, onRegenerateImage, onEditImage, onRegenerateText, onEditText, onFunMode, onGenerateVideo, error }) => {
  const [copied, setCopied] = useState(false);
  
  const [isImageEditing, setIsImageEditing] = useState(false);
  const [imageEditPrompt, setImageEditPrompt] = useState('');
  const [isImageLoading, setIsImageLoading] = useState(false);
  
  const [editedText, setEditedText] = useState(post.text);
  const [isTextEditing, setIsTextEditing] = useState(false);
  const [isTextLoading, setIsTextLoading] = useState(false);

  const [isVideoDirectorOpen, setIsVideoDirectorOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoLoadingMessage, setVideoLoadingMessage] = useState('');
  
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  
  useEffect(() => {
      setEditedText(post.text);
  }, [post.text]);

  useEffect(() => {
    // Cleanup function for the video object URL to prevent memory leaks.
    // This runs when the component unmounts or when videoUrl changes.
    const currentVideoUrl = videoUrl;
    return () => {
        if (currentVideoUrl && currentVideoUrl.startsWith('blob:')) {
            URL.revokeObjectURL(currentVideoUrl);
        }
    };
  }, [videoUrl]);

  const handleSave = async () => {
    triggerHapticFeedback();
    const link = document.createElement('a');

    if (videoUrl) {
      link.href = videoUrl;
      link.download = 'social-media-video.mp4';
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
    const textToCopy = editedText;
    const textForShareAPI = textToCopy.replace(/(\r\n|\n|\r)/gm, " ").replace(/\s+/g, ' ').trim();

    let copySuccess = false;
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        copySuccess = true;
      } catch (err) { copySuccess = synchronousCopy(textToCopy); }
    } else {
      copySuccess = synchronousCopy(textToCopy);
    }
    
    if (copySuccess) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }

    try {
      const mediaUrl = videoUrl || post.image;
      const mediaBlob = await (await fetch(mediaUrl)).blob();
      const fileName = videoUrl ? "social-media-video.mp4" : "social-media-post.jpg";
      const file = new File([mediaBlob], fileName, { type: mediaBlob.type });

      const shareData = {
        title: "New Car Celebration!",
        text: textForShareAPI,
        files: [file],
      };
      
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        alert("Web Share is not supported on your device, but the post text has been copied to your clipboard!");
      }
    } catch (error) {
       if (error instanceof DOMException && error.name === 'AbortError') {
         console.log('User cancelled the share dialog.');
       } else {
         console.error("Sharing failed:", error);
         alert("Could not open the share dialog, but the post text has been copied to your clipboard!");
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

  const handleGenerateVideo = async (style: VideoStyle) => {
    setIsVideoDirectorOpen(false);
    setIsVideoLoading(true);

    const messages = [
        "Setting up the virtual studio...", "Directing the AI animator...", "Adding special effects...", "Rendering the final cut...", "This can take a minute or two...",
    ];
    let messageIndex = 0;
    setVideoLoadingMessage(messages[messageIndex]);
    const intervalId = setInterval(() => {
        messageIndex = (messageIndex + 1) % messages.length;
        setVideoLoadingMessage(messages[messageIndex]);
    }, 4000);

    try {
        const url = await onGenerateVideo(style);
        setVideoUrl(url);
    } finally {
        setIsVideoLoading(false);
        clearInterval(intervalId);
    }
};


  return (
    <>
      <ImagePreviewModal 
        isOpen={isPreviewOpen && !videoUrl}
        onClose={() => setIsPreviewOpen(false)}
        imageSrc={post.image}
      />
      <EditTextModal 
        isOpen={isTextEditing}
        onClose={() => setIsTextEditing(false)}
        onSubmit={handleTextEditSubmit}
        originalText={post.text}
        isLoading={isTextLoading}
      />
      <VideoDirectorModal
          isOpen={isVideoDirectorOpen}
          onClose={() => setIsVideoDirectorOpen(false)}
          onSelectStyle={handleGenerateVideo}
      />
      <div className="w-full max-w-6xl mx-auto p-2 sm:p-4 md:p-6 space-y-6">
        <h2 className="text-3xl sm:text-4xl font-bold text-center text-white">Your Post is Ready!</h2>
        {error && (
          <div className="mb-4 bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg flex items-center justify-center gap-2">
            <Icon type="error" className="w-5 h-5"/>
            <span>{error}</span>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <div className="lg:col-span-2 flex flex-col items-center bg-white/5 p-4 rounded-2xl shadow-2xl space-y-4">
              <div className="relative w-full">
                  {(isImageLoading || isVideoLoading) && <LoadingOverlay message={isVideoLoading ? videoLoadingMessage : "Updating Image..."} />}
                  
                  {videoUrl ? (
                      <video src={videoUrl} controls autoPlay loop muted className="rounded-lg shadow-2xl w-full object-contain" />
                  ) : (
                      <button onClick={() => { triggerHapticFeedback(); setIsPreviewOpen(true); }} className="w-full block rounded-lg overflow-hidden focus:outline-none focus:ring-4 focus:ring-indigo-500/50" aria-label="Enlarge image">
                        <img src={post.image} alt="Generated social media post" className="rounded-lg shadow-2xl w-full object-contain" />
                      </button>
                  )}
              </div>

              <div className="w-full space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                      <button onClick={() => { triggerHapticFeedback(); handleImageAction(onRegenerateImage); }} disabled={isImageLoading || !!videoUrl} className="flex flex-col items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-3 px-4 rounded-lg hover:bg-white/20 transition-colors text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed aspect-square">
                          <Icon type="regenerate" className="w-5 h-5" />
                          <span>Regenerate</span>
                      </button>
                      
                       <button onClick={() => { triggerHapticFeedback(); setIsImageEditing(!isImageEditing); }} disabled={isImageLoading || !!videoUrl} className="flex flex-col items-center justify-center gap-2 bg-gradient-to-r from-sky-500 to-indigo-500 text-white font-bold py-3 px-4 rounded-lg hover:scale-105 transition-transform duration-300 text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed aspect-square">
                          <Icon type="edit" className="w-5 h-5" />
                          <span>{isImageEditing ? 'Cancel' : 'AI Image Edit'}</span>
                      </button>
                      
                      <button onClick={() => { triggerHapticFeedback(); handleImageAction(onFunMode); }} disabled={isImageLoading || !!videoUrl} className="flex flex-col items-center justify-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-3 px-4 rounded-lg hover:scale-105 transition-transform duration-300 text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed aspect-square">
                          <Icon type="sparkles" className="w-5 h-5" />
                          <span>Fun Mode</span>
                      </button>

                      <button onClick={handleSave} className="flex flex-col items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold py-3 px-4 rounded-lg hover:scale-105 transition-transform duration-300 text-xs sm:text-sm aspect-square">
                          <Icon type="download" className="w-5 h-5"/><span>Save {videoUrl ? 'Video' : 'Image'}</span>
                      </button>
                      
                       <button onClick={() => { triggerHapticFeedback(); setIsVideoDirectorOpen(true); }} disabled={isImageLoading || isVideoLoading} className="flex flex-col items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold py-3 px-4 rounded-lg hover:scale-105 transition-transform duration-300 text-xs sm:text-sm aspect-square disabled:opacity-50 disabled:cursor-not-allowed">
                          <Icon type="movie" /><span>{videoUrl ? 'New Video' : 'Animate with AI'}</span>
                      </button>
                      
                      <button onClick={() => { triggerHapticFeedback(); onStartOver(); }} className="flex flex-col items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-3 px-4 rounded-lg hover:bg-white/20 transition-colors text-xs sm:text-sm aspect-square">
                          <Icon type="restart" className="w-5 h-5"/>
                          <span>Create Another</span>
                      </button>
                  </div>
                  {isImageEditing && (
                      <div className="space-y-2 p-3 bg-slate-800/50 rounded-lg animate-fade-in">
                          <textarea value={imageEditPrompt} onChange={(e) => setImageEditPrompt(e.target.value)} placeholder="e.g., Make the text gold..." className="w-full bg-slate-800/50 text-white border-2 border-white/20 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition text-sm" rows={2}/>
                          <button onClick={() => { triggerHapticFeedback(); handleImageAction(() => onEditImage(imageEditPrompt)).then(() => setIsImageEditing(false)); }} disabled={!imageEditPrompt.trim()} className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold py-2 px-4 rounded-lg hover:scale-105 transition-transform duration-300 disabled:opacity-50 disabled:cursor-not-allowed">
                              Submit Edit
                          </button>
                      </div>
                  )}
              </div>
          </div>
          
          <div className="lg:col-span-1 bg-white/10 backdrop-blur-lg border border-white/20 p-4 lg:p-6 rounded-2xl flex flex-col">
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
              <div className="border-t border-white/10 my-4"></div>
              <div className="space-y-3">
                <button onClick={handleShare} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-teal-500 to-cyan-500 text-white font-bold py-3 px-4 rounded-lg hover:scale-105 transition-all duration-300 shadow-lg">
                    <Icon type="share"/><span>Share Post</span>
                </button>
                <button onClick={handleCopy} className="w-full flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-2 px-4 rounded-lg hover:bg-white/20 transition-colors">
                    <Icon type={copied ? 'check' : 'copy'} className="w-5 h-5" />
                    <span>{copied ? 'Copied!' : 'Copy Text Only'}</span>
                </button>
              </div>
          </div>
        </div>
      </div>
    </>
  );
};