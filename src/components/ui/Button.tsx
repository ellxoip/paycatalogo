import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      children,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      disabled,
      leftIcon,
      rightIcon,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const shouldReduceMotion = useReducedMotion();

    const baseStyles = 'inline-flex items-center justify-center font-manrope font-bold rounded-xl shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer';

    const variants = {
      primary: 'bg-primary hover:bg-primary/95 text-white focus:ring-primary/40 shadow-primary/10',
      secondary: 'bg-secondary hover:bg-secondary/95 text-white focus:ring-secondary/40 sheen-on-hover shadow-secondary/15',
      danger: 'bg-error-red hover:bg-error-red/95 text-white focus:ring-error-red/40 shadow-error-red/10',
      outline: 'bg-transparent border border-border-subtle hover:bg-surface-container-low text-text-charcoal focus:ring-slate-400',
    };

    const sizes = {
      sm: 'h-9 px-4 text-xs gap-1.5',
      md: 'h-12 px-5 text-sm gap-2',
      lg: 'h-14 px-6 text-base gap-2.5',
    };

    return (
      <motion.button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
        className={cn(
          baseStyles,
          variants[variant],
          sizes[size],
          className
        )}
        {...(props as any)}
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-current" />}
        {!isLoading && leftIcon}
        <span className="truncate">{children}</span>
        {!isLoading && rightIcon}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
