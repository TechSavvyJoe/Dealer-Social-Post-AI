import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw,
  Edit3,
  Sparkles,
  Download,
  Film,
  RotateCcw,
  Share2,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Undo2,
  Redo2
} from 'lucide-react';
import { GeneratedPost, VideoStyle, VideoRequestOptions } from '../types';
import { dataUrlToBlob } from '../utils/imageUtils';
import { ImagePreviewModal } from './ImagePreviewModal';
import { triggerHapticFeedback } from '../utils/haptics';
import { EditTextModal } from './EditTextModal';
import { VideoDirectorModal } from './VideoDirectorModal';
import { FunModeDirectorModal } from './FunModeDirectorModal';
import { Badge } from './ui/Badge';
import { cn } from '../utils/classNames';

interface PostResultProps {
  post: GeneratedPost;
  onStartOver: () => void;
  onRegenerateImage: () => Promise<void>;
  onEditImage: (prompt: string) => Promise<void>;
  onRegenerateText: () => Promise<void>;
  onEditText: (prompt: string) => Promise<void>;
  onFunMode: (styleName?: string) => Promise<void>;
  onGenerateVideo: (style: VideoStyle, options: VideoRequestOptions) => Promise<string>;
  error?: string | null;
  isDesktopLayout: boolean;
}

const LoadingOverlay: React.FC<{ message: string }> = React.memo(({ message }) => (
  <div className="absolute inset-0 bg-surface-900/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg z-10">
    <Loader2 className="h-12 w-12 text-primary-400 animate-spin mb-4" />
    <p className="text-surface-50 font-semibold animate-pulse">{message}</p>
  </div>
));


export const PostResult: React.FC<PostResultProps> = ({ post, onStartOver, onRegenerateImage, onEditImage, onRegenerateText, onEditText, onFunMode, onGenerateVideo, error, isDesktopLayout }) => {
  const [copied, setCopied] = useState(false);

  const [isImageEditing, setIsImageEditing] = useState(false);
  const [imageEditPrompt, setImageEditPrompt] = useState('');
  const [isImageLoading, setIsImageLoading] = useState(false);

  const [editedText, setEditedText] = useState(post.text);
  const [isTextEditing, setIsTextEditing] = useState(false);
  const [isTextLoading, setIsTextLoading] = useState(false);

  // Text history for undo/redo
  const [textHistory, setTextHistory] = useState<string[]>([post.text]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [isVideoDirectorOpen, setIsVideoDirectorOpen] = useState(false);
  const [isFunModeDirectorOpen, setIsFunModeDirectorOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoLoadingMessage, setVideoLoadingMessage] = useState('');
  const [videoJobs, setVideoJobs] = useState<Array<{
    id: string;
    style: VideoStyle;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    duration: number;
    soundtrack: string;
    url?: string;
    error?: string;
  }>>([]);

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  useEffect(() => {
    setEditedText(post.text);
    setTextHistory([post.text]);
    setHistoryIndex(0);
  }, [post.text]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, textHistory]);

  const handleTextChange = useCallback((newText: string) => {
    setEditedText(newText);
    // Add to history, removing any future history if we're not at the end
    const newHistory = textHistory.slice(0, historyIndex + 1);
    newHistory.push(newText);
    setTextHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [historyIndex, textHistory]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setEditedText(textHistory[newIndex]);
      triggerHapticFeedback();
    }
  }, [historyIndex, textHistory]);

  const handleRedo = useCallback(() => {
    if (historyIndex < textHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setEditedText(textHistory[newIndex]);
      triggerHapticFeedback();
    }
  }, [historyIndex, textHistory]);

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

  useEffect(() => {
    setVideoJobs([]);
    setVideoUrl(null);
  }, [post.image]);

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

  const handleGenerateVideo = async (style: VideoStyle, options: VideoRequestOptions) => {
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

    const jobId = `video-${Date.now()}`;
    setVideoJobs(prev => [...prev, { id: jobId, style, status: 'processing', duration: options.durationSeconds, soundtrack: options.soundtrack }]);

    try {
      const url = await onGenerateVideo(style, options);
      setVideoUrl(url);
      setVideoJobs(prev => prev.map(job => job.id === jobId ? { ...job, status: 'completed', url } : job));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setVideoJobs(prev => prev.map(job => job.id === jobId ? { ...job, status: 'failed', error: message } : job));
      throw error;
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
      <FunModeDirectorModal
        isOpen={isFunModeDirectorOpen}
        onClose={() => setIsFunModeDirectorOpen(false)}
        onSelectStyle={(styleName) => {
          setIsFunModeDirectorOpen(false);
          handleImageAction(() => onFunMode(styleName));
        }}
      />
      <motion.div
        className="w-full max-w-screen-2xl mx-auto px-1 sm:px-4 md:px-6 space-y-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      >
        <motion.h2
          className="text-3xl sm:text-4xl font-bold text-center text-surface-50"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
        >
          Your Post is Ready!
        </motion.h2>
        {error && (
          <motion.div
            className="mb-4 bg-error-900/50 border border-error-700 text-error-300 px-4 py-3 rounded-xl flex items-center justify-center gap-2"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </motion.div>
        )}
        <div className={`grid w-full ${isDesktopLayout ? 'grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-8' : 'grid-cols-1 gap-6'}`}>

          <div className="flex flex-col items-center bg-white/5 p-4 rounded-2xl shadow-2xl space-y-4">
            <div className="relative w-full">
              {(isImageLoading || isVideoLoading) && <LoadingOverlay message={isVideoLoading ? videoLoadingMessage : "Updating Image..."} />}

              {videoUrl ? (
                <video src={videoUrl} controls autoPlay loop muted className="rounded-xl shadow-2xl w-full object-contain" />
              ) : (
                <button onClick={() => { triggerHapticFeedback(); setIsPreviewOpen(true); }} className="w-full block rounded-xl overflow-hidden focus:outline-none focus:ring-4 focus:ring-primary-500/50 transition-all hover:ring-2 hover:ring-primary-400/30" aria-label="Enlarge image">
                  <img src={post.image} alt="Generated social media post" className="rounded-xl shadow-2xl w-full object-contain" />
                </button>
              )}
            </div>

            <div className="w-full space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <motion.button
                  onClick={() => { triggerHapticFeedback(); handleImageAction(onRegenerateImage); }}
                  disabled={isImageLoading || !!videoUrl}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2",
                    "bg-white/10 border border-white/20 text-surface-50 font-bold",
                    "py-3 px-4 rounded-xl transition-all duration-300",
                    "text-xs sm:text-sm aspect-square",
                    "hover:bg-white/20 hover:border-white/30",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <RefreshCw className="w-5 h-5" />
                  <span>Regenerate</span>
                </motion.button>

                <motion.button
                  onClick={() => { triggerHapticFeedback(); setIsImageEditing(!isImageEditing); }}
                  disabled={isImageLoading || !!videoUrl}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2",
                    "bg-gradient-to-r from-sky-500 to-primary-500 text-surface-50 font-bold",
                    "py-3 px-4 rounded-xl transition-all duration-300",
                    "text-xs sm:text-sm aspect-square",
                    "shadow-lg hover:shadow-glow-primary",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Edit3 className="w-5 h-5" />
                  <span>{isImageEditing ? 'Cancel' : 'AI Image Edit'}</span>
                </motion.button>

                <motion.button
                  onClick={() => { triggerHapticFeedback(); setIsFunModeDirectorOpen(true); }}
                  disabled={isImageLoading || !!videoUrl}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2",
                    "bg-gradient-to-r from-purple-500 to-pink-500 text-surface-50 font-bold",
                    "py-3 px-4 rounded-xl transition-all duration-300",
                    "text-xs sm:text-sm aspect-square",
                    "shadow-lg hover:shadow-[0_0_25px_rgba(168,85,247,0.5)]",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Sparkles className="w-5 h-5" />
                  <span>Fun Mode</span>
                </motion.button>

                <motion.button
                  onClick={handleSave}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2",
                    "bg-gradient-to-r from-success-500 to-emerald-600 text-surface-50 font-bold",
                    "py-3 px-4 rounded-xl transition-all duration-300",
                    "text-xs sm:text-sm aspect-square",
                    "shadow-lg hover:shadow-glow-success"
                  )}
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Download className="w-5 h-5" />
                  <span>Save {videoUrl ? 'Video' : 'Image'}</span>
                </motion.button>

                <motion.button
                  onClick={() => { triggerHapticFeedback(); setIsVideoDirectorOpen(true); }}
                  disabled={isImageLoading || isVideoLoading}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2",
                    "bg-gradient-to-r from-primary-500 to-secondary-600 text-surface-50 font-bold",
                    "py-3 px-4 rounded-xl transition-all duration-300",
                    "text-xs sm:text-sm aspect-square",
                    "shadow-lg hover:shadow-glow-primary",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Film className="w-5 h-5" />
                  <span>{videoUrl ? 'New Video' : 'Animate with AI'}</span>
                </motion.button>

                <motion.button
                  onClick={() => { triggerHapticFeedback(); onStartOver(); }}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2",
                    "bg-white/10 border border-white/20 text-surface-50 font-bold",
                    "py-3 px-4 rounded-xl transition-all duration-300",
                    "text-xs sm:text-sm aspect-square",
                    "hover:bg-white/20 hover:border-white/30"
                  )}
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <RotateCcw className="w-5 h-5" />
                  <span>Create Another</span>
                </motion.button>
              </div>
              <AnimatePresence>
                {isImageEditing && (
                  <motion.div
                    className="space-y-2 p-3 bg-surface-800/50 rounded-xl border border-white/10"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <textarea
                      value={imageEditPrompt}
                      onChange={(e) => setImageEditPrompt(e.target.value)}
                      placeholder="e.g., Make the text gold..."
                      className="w-full bg-surface-800/50 text-surface-50 border-2 border-white/20 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-400 focus:border-primary-400 outline-none transition text-sm"
                      rows={2}
                    />
                    <motion.button
                      onClick={() => { triggerHapticFeedback(); handleImageAction(() => onEditImage(imageEditPrompt)).then(() => setIsImageEditing(false)); }}
                      disabled={!imageEditPrompt.trim()}
                      className={cn(
                        "w-full bg-gradient-to-r from-primary-500 to-secondary-600",
                        "text-surface-50 font-bold py-2 px-4 rounded-xl",
                        "transition-all duration-300 shadow-lg hover:shadow-glow-primary",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                      )}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Submit Edit
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
              {videoJobs.length > 0 && (
                <motion.div
                  className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-3"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-surface-50">Video queue</span>
                    <span className="text-[10px] text-primary-200/70">{videoJobs.filter(job => job.status === 'processing').length} active</span>
                  </div>
                  <ul className="space-y-2">
                    {videoJobs.map(job => (
                      <motion.li
                        key={job.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-surface-900/40 px-3 py-2 text-xs"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="flex flex-col">
                          <span className="font-semibold text-surface-50">{job.style}</span>
                          <span className="text-primary-200/70">{job.duration}s · {job.soundtrack === 'none' ? 'No soundtrack' : job.soundtrack}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {job.status === 'completed' && <Badge variant="success">Ready</Badge>}
                          {job.status === 'processing' && <Badge variant="info">Rendering</Badge>}
                          {job.status === 'queued' && <Badge variant="neutral">Queued</Badge>}
                          {job.status === 'failed' && <Badge variant="warning">Failed</Badge>}
                          {job.url && (
                            <button
                              onClick={() => setVideoUrl(job.url || null)}
                              className="text-[10px] font-semibold uppercase tracking-wide text-primary-200 hover:text-surface-50 transition-colors"
                            >
                              Preview
                            </button>
                          )}
                        </div>
                        {job.error && <span className="text-[10px] text-warning-200">{job.error}</span>}
                      </motion.li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </div>
          </div>

          <motion.div
            className="bg-white/10 backdrop-blur-lg border border-white/20 p-4 lg:p-6 rounded-2xl flex flex-col"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            <h3 className="text-xl font-semibold mb-3 text-surface-50">Generated Social Post</h3>
            <div className="relative mb-4">
              {isTextLoading && <LoadingOverlay message="Updating Text..." />}
              {editedText !== post.text && (
                <div className="mb-2 flex items-center gap-2 text-xs text-warning-300">
                  <Edit3 className="w-3 h-3" />
                  <span>Text has been edited</span>
                </div>
              )}
              <textarea
                value={editedText}
                onChange={(e) => handleTextChange(e.target.value)}
                disabled={isTextLoading}
                className={cn(
                  "w-full h-40 lg:h-80 lg:max-h-[32rem]",
                  "bg-surface-800/50 text-surface-300 p-4 rounded-xl text-sm",
                  "resize-none border-2 border-transparent",
                  "focus:border-primary-400 focus:ring-2 focus:ring-primary-400",
                  "outline-none transition-all duration-300"
                )}
              />
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <motion.button
                  onClick={handleUndo}
                  disabled={historyIndex === 0}
                  className={cn(
                    "flex items-center justify-center gap-1",
                    "bg-white/10 border border-white/20 text-surface-50 font-medium",
                    "py-2 px-2 rounded-lg transition-all duration-300 text-xs",
                    "hover:bg-white/20 hover:border-white/30",
                    "disabled:opacity-30 disabled:cursor-not-allowed"
                  )}
                  whileHover={{ scale: historyIndex > 0 ? 1.05 : 1 }}
                  whileTap={{ scale: historyIndex > 0 ? 0.95 : 1 }}
                  title="Undo (Ctrl+Z)"
                >
                  <Undo2 className="w-3 h-3" />
                </motion.button>

                <motion.button
                  onClick={handleRedo}
                  disabled={historyIndex === textHistory.length - 1}
                  className={cn(
                    "flex items-center justify-center gap-1",
                    "bg-white/10 border border-white/20 text-surface-50 font-medium",
                    "py-2 px-2 rounded-lg transition-all duration-300 text-xs",
                    "hover:bg-white/20 hover:border-white/30",
                    "disabled:opacity-30 disabled:cursor-not-allowed"
                  )}
                  whileHover={{ scale: historyIndex < textHistory.length - 1 ? 1.05 : 1 }}
                  whileTap={{ scale: historyIndex < textHistory.length - 1 ? 0.95 : 1 }}
                  title="Redo (Ctrl+Y)"
                >
                  <Redo2 className="w-3 h-3" />
                </motion.button>

                <motion.button
                  onClick={() => { triggerHapticFeedback(); handleTextAction(onRegenerateText); }}
                  className={cn(
                    "flex items-center justify-center gap-1",
                    "bg-white/10 border border-white/20 text-surface-50 font-medium",
                    "py-2 px-2 rounded-lg transition-all duration-300 text-xs",
                    "hover:bg-white/20 hover:border-white/30",
                    "col-span-2"
                  )}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Regenerate</span>
                </motion.button>
              </div>

              <motion.button
                onClick={() => { triggerHapticFeedback(); setIsTextEditing(true); }}
                className={cn(
                  "w-full flex items-center justify-center gap-2",
                  "bg-gradient-to-r from-sky-500 to-primary-500 text-surface-50 font-bold",
                  "py-2 px-4 rounded-xl transition-all duration-300 text-sm",
                  "shadow-lg hover:shadow-glow-primary"
                )}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Edit3 className="w-4 h-4" />
                <span>Edit with AI</span>
              </motion.button>
            </div>
            <div className="border-t border-white/10 my-4"></div>
            <div className="space-y-3">
              <motion.button
                onClick={handleShare}
                className={cn(
                  "w-full flex items-center justify-center gap-2",
                  "bg-gradient-to-r from-teal-500 to-cyan-500 text-surface-50 font-bold",
                  "py-3 px-4 rounded-xl transition-all duration-300",
                  "shadow-lg hover:shadow-[0_0_25px_rgba(20,184,166,0.5)]"
                )}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Share2 className="w-5 h-5" />
                <span>Share Post</span>
              </motion.button>

              <motion.button
                onClick={handleCopy}
                className={cn(
                  "w-full flex items-center justify-center gap-2",
                  "bg-white/10 border border-white/20 text-surface-50 font-bold",
                  "py-2 px-4 rounded-xl transition-all duration-300",
                  "hover:bg-white/20 hover:border-white/30"
                )}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                <span>{copied ? 'Copied!' : 'Copy Text Only'}</span>
              </motion.button>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </>
  );
};
