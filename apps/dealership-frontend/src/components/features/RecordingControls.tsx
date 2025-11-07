import { motion } from 'framer-motion';
import { Mic, Square, Pause, Play } from 'lucide-react';
import { Button } from '../ui/button';
import { cn, formatDuration } from '../../lib/utils';

interface RecordingControlsProps {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  disabled?: boolean;
}

export function RecordingControls({
  isRecording,
  isPaused,
  duration,
  onStart,
  onStop,
  onPause,
  onResume,
  disabled,
}: RecordingControlsProps) {
  return (
    <div className="flex flex-col items-center gap-6">
      {/* Timer */}
      {isRecording && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-4xl font-mono font-bold tabular-nums"
        >
          {formatDuration(duration)}
        </motion.div>
      )}

      {/* Main Record Button */}
      <div className="flex items-center gap-4">
        {!isRecording ? (
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button
              size="lg"
              onClick={onStart}
              disabled={disabled}
              className={cn(
                'w-24 h-24 rounded-full shadow-lg relative',
                'bg-red-500 hover:bg-red-600 text-white',
                'before:absolute before:inset-0 before:rounded-full',
                'before:animate-ping before:bg-red-400 before:opacity-75'
              )}
            >
              <Mic className="w-10 h-10" />
            </Button>
          </motion.div>
        ) : (
          <>
            {/* Pause/Resume */}
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                size="lg"
                variant="outline"
                onClick={isPaused ? onResume : onPause}
                className="w-16 h-16 rounded-full"
              >
                {isPaused ? <Play className="w-6 h-6" /> : <Pause className="w-6 h-6" />}
              </Button>
            </motion.div>

            {/* Stop */}
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                size="lg"
                onClick={onStop}
                className="w-24 h-24 rounded-full bg-red-500 hover:bg-red-600"
              >
                <Square className="w-10 h-10 fill-current" />
              </Button>
            </motion.div>
          </>
        )}
      </div>

      {/* Status Text */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-sm text-muted-foreground"
      >
        {!isRecording
          ? 'Click to start recording'
          : isPaused
          ? 'Recording paused'
          : 'Recording in progress...'}
      </motion.p>
    </div>
  );
}
