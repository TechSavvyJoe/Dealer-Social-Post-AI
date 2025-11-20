import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../utils/classNames';

interface ProgressBarProps {
    value: number; // 0-100
    message?: string;
    estimatedTime?: string;
    className?: string;
    loadingLabel?: string;
    /**
     * Show animated shimmer effect
     */
    showShimmer?: boolean;
    /**
     * Size variant
     */
    size?: 'sm' | 'md' | 'lg';
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
    value,
    message,
    estimatedTime,
    className = '',
    loadingLabel = 'Working...',
    showShimmer = true,
    size = 'md',
}) => {
    const clampedValue = Math.min(100, Math.max(0, value));

    const sizeStyles = {
        sm: 'h-1.5',
        md: 'h-2.5',
        lg: 'h-3',
    };

    return (
        <div className={cn('w-full', className)}>
            {message && (
                <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-3 text-sm font-medium text-surface-100"
                >
                    {message}
                </motion.div>
            )}

            <div
                className={cn(
                    'relative bg-surface-800/50 rounded-full overflow-hidden backdrop-blur-sm border border-white/5',
                    sizeStyles[size]
                )}
                role="progressbar"
                aria-valuenow={clampedValue}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={loadingLabel}
            >
                <motion.div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary-500 via-primary-400 to-primary-500 rounded-full"
                    initial={{ width: '0%' }}
                    animate={{ width: `${clampedValue}%` }}
                    transition={{
                        duration: 0.5,
                        ease: [0.4, 0.0, 0.2, 1], // easeOut
                    }}
                >
                    {showShimmer && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent shimmer" />
                    )}
                </motion.div>
            </div>

            <div className="mt-2 flex justify-between text-xs text-surface-400">
                <motion.span
                    key={clampedValue}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="font-mono"
                >
                    {Math.round(clampedValue)}%
                </motion.span>
                {estimatedTime && (
                    <span className="font-medium">{estimatedTime}</span>
                )}
            </div>
        </div>
    );
};
