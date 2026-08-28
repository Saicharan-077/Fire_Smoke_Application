import React from 'react';
import { cn } from './Button';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Card: React.FC<CardProps> = ({ className, children, ...props }) => {
  return (
    <div className={cn("glass border border-[var(--color-border)] rounded-2xl shadow-sm overflow-hidden text-[var(--color-fg)] font-sans", className)} {...props}>
      {children}
    </div>
  );
};

export const CardHeader: React.FC<CardProps> = ({ className, children, ...props }) => (
  <div className={cn("px-6 py-4 border-b border-[var(--color-border)] bg-[var(--glass-light-bg)]", className)} {...props}>
    {children}
  </div>
);

export const CardTitle: React.FC<CardProps> = ({ className, children, ...props }) => (
  <h3 className={cn("text-lg font-bold text-[var(--color-fg)] leading-tight", className)} {...props}>
    {children}
  </h3>
);

export const CardContent: React.FC<CardProps> = ({ className, children, ...props }) => (
  <div className={cn("p-6", className)} {...props}>
    {children}
  </div>
);

export default Card;
