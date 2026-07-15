import React from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  onClose?: () => void;
  actionText?: string;
  onActionClick?: () => void;
}

export const Toast: React.FC<ToastProps> = ({
  variant = 'info',
  title,
  message,
  onClose,
  actionText,
  onActionClick,
  className,
  ...props
}) => {
  const styles = {
    success: 'border-success-green/30 bg-success-green/10 text-success-green',
    error: 'border-error-red/30 bg-error-red/10 text-error-red',
    warning: 'border-warning-orange/30 bg-warning-orange/10 text-warning-orange',
    info: 'border-secondary/20 bg-secondary/10 text-primary',
  };

  const icons = {
    success: CheckCircle2,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const IconComponent = icons[variant];

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex gap-3 rounded-xl border p-4 shadow-sm relative overflow-hidden transition-all',
        styles[variant],
        className
      )}
      {...props}
    >
      {IconComponent && <IconComponent className="h-5 w-5 shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        {title && <p className="text-sm font-extrabold mb-0.5">{title}</p>}
        <p className="text-xs leading-relaxed text-on-surface-variant font-medium">{message}</p>
        {actionText && onActionClick && (
          <button
            type="button"
            onClick={onActionClick}
            className="mt-2 text-xs font-bold underline cursor-pointer hover:opacity-85 block"
          >
            {actionText}
          </button>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar mensaje"
          className="h-6 w-6 shrink-0 flex items-center justify-center rounded-lg hover:bg-black/5 active:scale-95 transition-all cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};

export default Toast;
