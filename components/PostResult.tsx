import React, { useState } from 'react';
import { GeneratedPost } from '../types';
import { dataUrlToBlob } from '../utils/imageUtils';
import { Icon } from './Icons';

interface PostResultProps {
  post: GeneratedPost;
  onStartOver: () => void;
}

export const PostResult: React.FC<PostResultProps> = ({ post, onStartOver }) => {
  const [copied, setCopied] = useState(false);

  const handleSave = () => {
    const link = document.createElement('a');
    link.href = post.image;
    link.download = 'social-media-post.jpg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Uses a synchronous method to copy text, which is more reliable in complex scenarios.
  const synchronousCopy = (text: string): boolean => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    // Prevent screen from jumping
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.width = "2em";
    textArea.style.height = "2em";
    textArea.style.padding = "0";
    textArea.style.border = "none";
    textArea.style.outline = "none";
    textArea.style.boxShadow = "none";
    textArea.style.background = "transparent";

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
    let success = false;
    // Try modern async API first, as it's cleaner.
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(post.text);
        success = true;
      } catch (err) {
        console.warn("Async clipboard API failed, falling back to sync method.", err);
        // Fallback to synchronous method if modern API fails.
        success = synchronousCopy(post.text);
      }
    } else {
      // Use synchronous method if clipboard API is not available at all.
      success = synchronousCopy(post.text);
    }

    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      alert("Failed to copy text to clipboard.");
    }
  };

  const handleShare = async () => {
    // CRITICAL FIX: To prevent a race condition on mobile where the share
    // dialog interrupts an async clipboard write, we MUST use a synchronous
    // copy method here. This ensures the text is on the clipboard *before*
    // the share dialog is even invoked.
    const copiedSuccess = synchronousCopy(post.text);

    if (copiedSuccess) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }

    try {
      const blob = await dataUrlToBlob(post.image);
      const file = new File([blob], "social-media-post.jpg", { type: blob.type });
      const shareData = {
        title: "New Car Celebration!",
        text: post.text,
        files: [file],
      };

      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        // Fallback for devices that don't support sharing files.
        if (copiedSuccess) {
          alert("Sharing is not available on this device, but the post text has been copied to your clipboard!");
        } else {
          alert("Sharing is not available on this device. Please use the copy and save buttons manually.");
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // This is expected user behavior (closing the share dialog). Do nothing.
        console.log("Share dialog was cancelled by the user.");
      } else {
        // Generic fallback for any other share errors.
        console.error("Sharing failed or is not supported:", error);
        if (copiedSuccess) {
          alert("Could not open share dialog, but your post text has been copied to the clipboard!");
        } else {
          alert("Could not share or copy. Please try saving the image and copying the text manually.");
        }
      }
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-4 md:p-6 space-y-6 animate-fade-in">
      <h2 className="text-4xl font-bold text-center text-white">Your Post is Ready!</h2>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        
        {/* Left Column: Image */}
        <div className="lg:col-span-3 flex flex-col items-center bg-white/5 p-4 rounded-2xl shadow-2xl">
            <img src={post.image} alt="Generated social media post" className="rounded-lg shadow-2xl w-full object-contain" />
             <div className="w-full mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button onClick={handleSave} className="flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold py-3 px-4 rounded-lg hover:scale-105 transition-transform duration-300">
                    <Icon type="download" />
                    <span>Save Image</span>
                </button>
                 <button onClick={handleShare} className="flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold py-3 px-4 rounded-lg hover:scale-105 transition-transform duration-300">
                    <Icon type="share"/>
                    <span>Share Post</span>
                </button>
             </div>
        </div>
        
        {/* Right Column: Text & Actions */}
        <div className="lg:col-span-2 bg-white/10 backdrop-blur-lg border border-white/20 p-6 rounded-2xl flex flex-col">
            <h3 className="text-xl font-semibold mb-3 text-white">Generated Social Post</h3>
            <div className="relative flex-grow">
                <div className="w-full h-full bg-slate-800/50 text-slate-300 p-4 rounded-md overflow-y-auto whitespace-pre-wrap text-sm">
                    {post.text}
                </div>
            </div>
             <button onClick={handleCopy} className="w-full mt-4 flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-3 px-4 rounded-lg hover:bg-white/20 transition-colors">
                <Icon type={copied ? 'check' : 'copy'} className="w-5 h-5" />
                <span>{copied ? 'Copied!' : 'Copy Text'}</span>
            </button>
        </div>
      </div>
      
      <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row justify-center items-center gap-4">
        <button onClick={onStartOver} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-bold py-3 px-8 rounded-full hover:bg-white/20 transition-colors text-lg">
           <Icon type="restart" className="w-5 h-5"/>
           <span>Create Another</span>
        </button>
      </div>
    </div>
  );
};