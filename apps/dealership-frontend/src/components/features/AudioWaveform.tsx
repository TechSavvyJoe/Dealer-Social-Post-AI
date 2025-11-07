import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

interface AudioWaveformProps {
  audioLevel: number;
  isActive: boolean;
  className?: string;
}

export function AudioWaveform({ audioLevel, isActive, className }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const barsRef = useRef<number[]>(new Array(40).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bars = barsRef.current;
    const barCount = bars.length;

    const animate = () => {
      const width = canvas.width;
      const height = canvas.height;

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      // Update bars
      if (isActive) {
        // Shift bars left
        for (let i = 0; i < barCount - 1; i++) {
          bars[i] = bars[i + 1];
        }
        // Add new bar based on audio level
        bars[barCount - 1] = audioLevel / 100;
      } else {
        // Decay bars when not active
        for (let i = 0; i < barCount; i++) {
          bars[i] = bars[i] * 0.95;
        }
      }

      // Draw bars
      const barWidth = width / barCount;

      // Get the computed primary color from CSS variable
      const primaryColor = getComputedStyle(canvas).getPropertyValue('--primary').trim();
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, `hsl(${primaryColor})`);
      gradient.addColorStop(1, `hsl(${primaryColor} / 0.3)`);

      bars.forEach((value, index) => {
        const x = index * barWidth;
        const barHeight = Math.max(2, value * height);
        const y = height - barHeight;

        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth - 2, barHeight);
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [audioLevel, isActive]);

  return (
    <div className={cn('relative w-full h-24 rounded-lg overflow-hidden bg-muted/20', className)}>
      <canvas
        ref={canvasRef}
        width={800}
        height={96}
        className="w-full h-full"
      />
      {!isActive && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Waiting for audio...
        </div>
      )}
    </div>
  );
}

export function AudioLevelIndicator({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {Array.from({ length: 10 }).map((_, i) => {
          const threshold = (i + 1) * 10;
          const isActive = level >= threshold;
          return (
            <motion.div
              key={i}
              initial={false}
              animate={{
                height: isActive ? '100%' : '20%',
                backgroundColor: isActive
                  ? i < 7
                    ? 'hsl(var(--primary))'
                    : i < 9
                    ? 'hsl(45, 93%, 47%)'
                    : 'hsl(0, 84%, 60%)'
                  : 'hsl(var(--muted))',
              }}
              transition={{ duration: 0.1 }}
              className="w-1 rounded-full"
              style={{ height: '24px' }}
            />
          );
        })}
      </div>
      <span className="text-xs text-muted-foreground font-mono">{level}%</span>
    </div>
  );
}
