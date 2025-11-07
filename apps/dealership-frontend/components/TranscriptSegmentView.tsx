import React, { useState, useRef, useEffect } from 'react';
import { TranscriptSegment } from '../types';
import EditIcon from './icons/EditIcon';
import SaveIcon from './icons/SaveIcon';
import CancelIcon from './icons/CancelIcon';
import SalesmanIcon from './icons/SalesmanIcon';
import CustomerIcon from './icons/CustomerIcon';

interface TranscriptSegmentViewProps {
  segment: TranscriptSegment;
  onUpdate: (id: number, updates: { text: string; speaker: string; timestamp: string }) => void;
  isWIP?: boolean; // Work in Progress
  isReadOnly?: boolean;
}

const TranscriptSegmentView: React.FC<TranscriptSegmentViewProps> = ({ segment, onUpdate, isWIP = false, isReadOnly = false }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(segment.text);
  const [editSpeaker, setEditSpeaker] = useState(segment.speaker || 'Speaker');
  const [editTimestamp, setEditTimestamp] = useState(segment.timestamp);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Use segment.speaker to determine persistent layout, avoiding shifts during editing
  const speakerType = (segment.speaker || '').toLowerCase().includes('sales') 
    ? 'salesperson' 
    : (segment.speaker || '').toLowerCase().includes('cust') 
    ? 'customer' 
    : 'unknown';

  useEffect(() => {
    // Sync local state if parent component's data changes, but not during an active edit session
    if (!isEditing) {
        setEditText(segment.text);
        setEditSpeaker(segment.speaker || 'Speaker');
        setEditTimestamp(segment.timestamp);
    }
  }, [segment, isEditing]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [isEditing]);
  
  const handleSave = () => {
    onUpdate(segment.id, {
        text: editText,
        speaker: editSpeaker,
        timestamp: editTimestamp,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    // Reset state to original segment values before edit
    setEditText(segment.text);
    setEditSpeaker(segment.speaker || 'Speaker');
    setEditTimestamp(segment.timestamp);
    setIsEditing(false);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement && e.shiftKey)) {
          e.preventDefault();
          handleSave();
      }
      if (e.key === 'Escape') {
          e.preventDefault();
          handleCancel();
      }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setEditText(e.target.value);
      e.target.style.height = 'auto';
      e.target.style.height = `${e.target.scrollHeight}px`;
  };

  const SpeakerIcon = () => {
    switch (speakerType) {
      case 'salesperson': return <SalesmanIcon className="w-5 h-5" />;
      case 'customer': return <CustomerIcon className="w-5 h-5" />;
      default: return null;
    }
  };

  const bubbleStyles = {
    salesperson: 'bg-blue-600/50 text-white rounded-br-none self-end',
    customer: 'bg-gray-700/80 text-gray-200 rounded-bl-none self-start',
    unknown: 'bg-gray-700/40 text-gray-300 self-start',
  };
  
  const rowStyles = {
    salesperson: 'flex-row-reverse',
    customer: 'flex-row',
    unknown: 'flex-row',
  };
  
  const inputStyle = "bg-gray-900/50 rounded-md px-1 py-0 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition";

  return (
    <div className={`flex items-start gap-3 group w-full ${rowStyles[speakerType]}`}>
      <div className={`w-8 h-8 rounded-full mt-2 flex-shrink-0 flex items-center justify-center text-white ${speakerType === 'salesperson' ? 'bg-blue-500' : 'bg-green-500'}`}>
        <SpeakerIcon />
      </div>

      <div className={`flex flex-col max-w-[80%] ${speakerType === 'salesperson' ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center gap-2 mb-1 h-5">
            {isEditing ? (
                <>
                    <input 
                        type="text"
                        value={editSpeaker}
                        onChange={(e) => setEditSpeaker(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className={`${inputStyle} font-bold text-gray-300 w-32`}
                        placeholder="Speaker"
                    />
                    <input
                        type="text"
                        value={editTimestamp}
                        onChange={(e) => setEditTimestamp(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className={`${inputStyle} font-mono text-gray-400 w-20`}
                    />
                </>
            ) : (
                <>
                    <span className="text-xs font-bold text-gray-400">{segment.speaker || 'Speaker'}</span>
                    <span className="text-xs font-mono text-gray-500">{segment.timestamp}</span>
                </>
            )}
        </div>

        <div className={`relative flex items-center p-3 rounded-2xl ${bubbleStyles[speakerType]}`}>
           <div className="flex-grow">
            {isEditing ? (
              <textarea
                ref={textareaRef}
                value={editText}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent focus:outline-none resize-none overflow-hidden min-w-[200px]"
              />
            ) : (
              <p className="leading-relaxed whitespace-pre-wrap">{segment.text}</p>
            )}
          </div>
          <div className={`absolute top-1/2 -translate-y-1/2 ${speakerType === 'salesperson' ? '-left-10' : '-right-10'} flex items-center gap-1`}>
            {!isWIP && !isReadOnly && (
                isEditing ? (
                    <>
                        <button onClick={handleSave} title="Save (Enter)" className="text-green-400 hover:text-green-300 transition-colors p-1 rounded-full bg-gray-900/50">
                            <SaveIcon className="w-4 h-4" />
                        </button>
                        <button onClick={handleCancel} title="Cancel (Esc)" className="text-red-400 hover:text-red-300 transition-colors p-1 rounded-full bg-gray-900/50">
                            <CancelIcon className="w-4 h-4" />
                        </button>
                    </>
                ) : (
                    <button onClick={() => setIsEditing(true)} title="Edit" className="text-gray-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full bg-gray-900/50">
                        <EditIcon className="w-4 h-4" />
                    </button>
                )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TranscriptSegmentView;
