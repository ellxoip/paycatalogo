import React from 'react';
import { cn } from '../../lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'block' | 'circle' | 'text';
}

export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'block',
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        'skeleton animate-pulse',
        variant === 'circle' && 'rounded-full',
        variant === 'text' && 'h-3.5 w-full rounded',
        variant === 'block' && 'rounded-xl',
        className
      )}
      {...props}
    />
  );
};

export default Skeleton;
