import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, UserCircle2, Edit2, Copy, Check } from 'lucide-react';
import { TranscriptSegment } from '../../types';
import { cn, formatDateTime, copyToClipboard } from '../../lib/utils';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';

interface TranscriptDisplayProps {
  segments: TranscriptSegment[];
  isLive?: boolean;
  onUpdateSegment?: (index: number, updates: Partial<TranscriptSegment>) => void;
}

export function TranscriptDisplay({ segments, isLive, onUpdateSegment }: TranscriptDisplayProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editedSpeaker, setEditedSpeaker] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopyAll = async () => {
    const text = segments
      .map((seg) => `[${seg.timestamp}] ${seg.speaker || 'Unknown'}: ${seg.text}`)
      .join('\n\n');
    const success = await copyToClipboard(text);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const startEditing = (index: number, currentSpeaker: string) => {
    setEditingIndex(index);
    setEditedSpeaker(currentSpeaker || '');
  };

  const saveEdit = (index: number) => {
    if (onUpdateSegment && editedSpeaker.trim()) {
      onUpdateSegment(index, { speaker: editedSpeaker.trim() });
    }
    setEditingIndex(null);
  };

  if (segments.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">
          {isLive ? 'Transcript will appear here as you speak...' : 'No transcript available'}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Transcript</h3>
          {isLive && (
            <Badge variant="default" className="animate-pulse">
              Live
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={handleCopyAll}>
          {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
          {copied ? 'Copied!' : 'Copy All'}
        </Button>
      </div>

      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 hide-scrollbar">
        <AnimatePresence mode="popLayout">
          {segments.map((segment, index) => (
            <motion.div
              key={segment.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              layout
            >
              <TranscriptSegmentCard
                segment={segment}
                isEditing={editingIndex === index}
                editedSpeaker={editedSpeaker}
                onEdit={() => startEditing(index, segment.speaker || '')}
                onSave={() => saveEdit(index)}
                onCancel={() => setEditingIndex(null)}
                onSpeakerChange={setEditedSpeaker}
                canEdit={!!onUpdateSegment}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface TranscriptSegmentCardProps {
  segment: TranscriptSegment;
  isEditing: boolean;
  editedSpeaker: string;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onSpeakerChange: (value: string) => void;
  canEdit: boolean;
}

function TranscriptSegmentCard({
  segment,
  isEditing,
  editedSpeaker,
  onEdit,
  onSave,
  onCancel,
  onSpeakerChange,
  canEdit,
}: TranscriptSegmentCardProps) {
  const isSalesperson = segment.speaker?.toLowerCase().includes('salesperson');

  return (
    <div
      className={cn(
        'flex gap-3 p-4 rounded-lg border transition-all hover:shadow-md',
        isSalesperson ? 'bg-primary/5 border-primary/20' : 'bg-muted/50 border-border'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
          isSalesperson ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
        )}
      >
        {isSalesperson ? <UserCircle2 className="w-5 h-5" /> : <User className="w-5 h-5" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Input
                value={editedSpeaker}
                onChange={(e) => onSpeakerChange(e.target.value)}
                className="h-7 w-40"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSave();
                  if (e.key === 'Escape') onCancel();
                }}
              />
              <Button size="sm" variant="ghost" onClick={onSave}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <span className="font-semibold text-sm">
                {segment.speaker || 'Unknown Speaker'}
              </span>
              {canEdit && (
                <button
                  onClick={onEdit}
                  className="opacity-0 group-hover:opacity-100 hover:text-primary transition-opacity"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              )}
            </>
          )}
          <span className="text-xs text-muted-foreground">{segment.timestamp}</span>
        </div>

        {/* Text */}
        <p className="text-sm leading-relaxed">{segment.text}</p>
      </div>
    </div>
  );
}
