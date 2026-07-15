import React, { useId } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  textarea?: boolean;
  rows?: number;
}

export const Field = React.forwardRef<HTMLInputElement | HTMLTextAreaElement, FieldProps>(
  ({ label, hint, error, className, textarea = false, rows = 4, disabled, ...props }, ref) => {
    const defaultId = useId();
    const id = props.id || defaultId;
    const errorId = `${id}-error`;
    const hintId = `${id}-hint`;

    const inputStyles = cn(
      'w-full rounded-xl border border-border-subtle bg-white px-4 py-3 text-sm outline-none transition-all focus:border-secondary focus:ring-2 focus:ring-secondary/15 disabled:bg-slate-50 disabled:text-slate-400 font-medium',
      error && 'border-error-red/50 focus:border-error-red focus:ring-error-red/15',
      disabled && 'cursor-not-allowed opacity-75'
    );

    return (
      <div className={cn('block w-full text-left space-y-1.5', className)}>
        <label
          htmlFor={id}
          className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant font-manrope"
        >
          {label}
        </label>
        
        <div className="relative">
          {textarea ? (
            <textarea
              id={id}
              ref={ref as React.Ref<HTMLTextAreaElement>}
              rows={rows}
              disabled={disabled}
              aria-describedby={cn(error && errorId, hint && hintId) || undefined}
              className={cn(inputStyles, 'resize-none py-3')}
              {...(props as any)}
            />
          ) : (
            <input
              id={id}
              ref={ref as React.Ref<HTMLInputElement>}
              disabled={disabled}
              aria-describedby={cn(error && errorId, hint && hintId) || undefined}
              className={inputStyles}
              {...(props as any)}
            />
          )}
        </div>

        {hint && !error && (
          <p id={hintId} className="text-[11px] text-on-surface-variant/80 font-medium leading-normal">
            {hint}
          </p>
        )}

        {error && (
          <p id={errorId} className="flex items-center gap-1 text-[11px] font-semibold text-error-red leading-normal">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>
    );
  }
);

Field.displayName = 'Field';
export default Field;
