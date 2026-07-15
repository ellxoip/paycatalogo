import React from 'react';
import { cn } from '../../lib/utils';

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0 to 100
  max?: number;
  variant?: 'success' | 'danger' | 'secondary';
  label?: string;
  showText?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  variant = 'secondary',
  label,
  showText = false,
  className,
  ...props
}) => {
  const percentage = Math.max(0, Math.min(100, Math.round((value / max) * 100)));

  const barColors = {
    success: 'bg-success-green',
    danger: 'bg-error-red',
    secondary: 'bg-secondary',
  };

  return (
    <div className={cn('w-full', className)} {...props}>
      {(label || showText) && (
        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-on-surface-variant">
          {label && <span>{label}</span>}
          {showText && <span>{percentage}%</span>}
        </div>
      )}
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-surface-container-high"
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || 'Progreso'}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            barColors[variant]
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

export default ProgressBar;
