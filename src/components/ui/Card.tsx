import React from 'react';
import { cn } from '../../lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'interactive' | 'danger' | 'success' | 'warning';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, children, variant = 'default', padding = 'md', ...props }, ref) => {
    const baseStyles = 'overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-300';
    
    const variants = {
      default: 'border-border-subtle bg-white',
      interactive: 'border-border-subtle bg-white lift-on-hover hover:border-secondary/40 cursor-pointer',
      danger: 'border-error-red/20 bg-error-red/[0.02] dark:bg-error-red/[0.04]',
      success: 'border-success-green/20 bg-success-green/[0.02]',
      warning: 'border-warning-orange/20 bg-warning-orange/[0.02]',
    };

    const paddings = {
      none: 'p-0',
      sm: 'p-4',
      md: 'p-5 md:p-6',
      lg: 'p-6 md:p-8',
    };

    return (
      <div
        ref={ref}
        className={cn(baseStyles, variants[variant], paddings[padding], className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';
export default Card;
