import React from 'react';

interface ProgressBarProps {
    value: number; // 0-100
    message?: string;
    estimatedTime?: string;
    className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
    value,
    message,
    estimatedTime,
    className = ''
}) => {
    const clampedValue = Math.min(100, Math.max(0, value));

    return (
        <div className={`w-full ${className}`}>
            {message && (
                <div className="mb-2 text-sm font-medium text-white/90">
                    {message}
                </div>
            )}

            <div className="relative h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary-500 to-primary-400 transition-all duration-500 ease-out rounded-full"
                    style={{ width: `${clampedValue}%` }}
                >
                    <div className="absolute inset-0 bg-white/20 animate-pulse" />
                </div>
            </div>

            <div className="mt-2 flex justify-between text-xs text-white/60">
                <span>{Math.round(clampedValue)}%</span>
                {estimatedTime && <span>{estimatedTime}</span>}
            </div>
        </div>
    );
};
