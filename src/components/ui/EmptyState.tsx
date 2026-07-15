import React from 'react';
import { LucideIcon } from 'lucide-react';
import Button from './Button';
import Card from './Card';
import { cn } from '../../lib/utils';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionText?: string;
  onActionClick?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actionText,
  onActionClick,
  className,
  ...props
}) => {
  return (
    <Card
      variant="default"
      padding="lg"
      className={cn('flex flex-col items-center text-center space-y-4 max-w-md mx-auto', className)}
      {...props}
    >
      {Icon && (
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary/10 text-secondary">
          <Icon className="h-8 w-8" />
        </div>
      )}
      <div className="space-y-2">
        <h3 className="font-headline-md text-base font-bold text-primary">{title}</h3>
        <p className="font-body-sm text-xs leading-relaxed text-on-surface-variant">
          {description}
        </p>
      </div>
      {actionText && onActionClick && (
        <Button variant="secondary" onClick={onActionClick} className="mt-2 w-full sm:w-auto">
          {actionText}
        </Button>
      )}
    </Card>
  );
};

export default EmptyState;
