import React from 'react';
import { cn } from '../../utils/classNames';

type Variant = 'info' | 'success' | 'warning' | 'neutral';

const variantStyles: Record<Variant, string> = {
  info: 'bg-indigo-500/20 text-indigo-100 border border-indigo-400/30',
  success: 'bg-emerald-500/20 text-emerald-100 border border-emerald-400/30',
  warning: 'bg-amber-500/20 text-amber-100 border border-amber-400/30',
  neutral: 'bg-white/10 text-slate-200 border border-white/15',
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export const Badge: React.FC<BadgeProps> = ({ className, variant = 'neutral', ...props }) => (
  <span
    className={cn('inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide', variantStyles[variant], className)}
    {...props}
  />
);
