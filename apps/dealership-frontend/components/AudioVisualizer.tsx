import React from 'react';

interface AudioVisualizerProps {
  level: number; // A normalized value, typically 0 to 1
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ level }) => {
  const barCount = 12;
  const bars = Array.from({ length: barCount });
  const activeBars = Math.round(level * barCount);

  return (
    <div className="flex items-end justify-center space-x-1 h-10 w-24">
      {bars.map((_, i) => (
        <div
          key={i}
          className={`w-1 rounded-full transition-all duration-75 ease-in-out
            ${i < activeBars ? 'bg-green-400' : 'bg-gray-600'}
          `}
          style={{ height: `${i < activeBars ? Math.min(100, 10 + (level * (i + 1) * 8)) : 10}%` }}
        ></div>
      ))}
    </div>
  );
};

export default AudioVisualizer;