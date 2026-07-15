import React from 'react';
import { CheckCircle2, AlertCircle, Clock, Info } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'success' | 'warning' | 'danger' | 'info';
  showIcon?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  children,
  variant = 'info',
  showIcon = true,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider';

  const variants = {
    success: 'border-success-green/30 bg-success-green/10 text-success-green',
    warning: 'border-warning-orange/30 bg-warning-orange/10 text-warning-orange',
    danger: 'border-error-red/30 bg-error-red/10 text-error-red',
    info: 'border-secondary/20 bg-secondary/10 text-secondary',
  };

  const icons = {
    success: CheckCircle2,
    warning: Clock,
    danger: AlertCircle,
    info: Info,
  };

  const IconComponent = icons[variant];

  return (
    <span
      className={cn(baseStyles, variants[variant], className)}
      {...props}
    >
      {showIcon && IconComponent && <IconComponent className="h-3 w-3 shrink-0" />}
      {children}
    </span>
  );
};

export default Badge;
