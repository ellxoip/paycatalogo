import React from 'react';
import { formatCurrency } from '../../lib/cart';
import { cn } from '../../lib/utils';

export interface MoneyProps extends React.HTMLAttributes<HTMLSpanElement> {
  amount: number;
  moneda?: string;
}

export const Money: React.FC<MoneyProps> = ({ amount, moneda, className, ...props }) => {
  return (
    <span
      className={cn('font-numeric-data text-numeric-data font-bold tracking-tight', className)}
      {...props}
    >
      {formatCurrency(amount, moneda)}
    </span>
  );
};

export default Money;
