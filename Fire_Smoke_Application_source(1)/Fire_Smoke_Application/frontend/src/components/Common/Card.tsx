import React from 'react';
import { cn } from './Button';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Card: React.FC<CardProps> = ({ className, children, style, ...props }) => {
  return (
    <div
      className={cn("border rounded-2xl shadow-sm overflow-hidden", className)}
      style={{ background: 'var(--surface)', borderColor: 'var(--border)', ...style }}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<CardProps> = ({ className, children, style, ...props }) => (
  <div className={cn("px-6 py-4 border-b", className)} style={{ borderColor: 'var(--border)', ...style }} {...props}>
    {children}
  </div>
);

export const CardTitle: React.FC<CardProps> = ({ className, children, style, ...props }) => (
  <h3 className={cn("text-lg font-semibold leading-tight", className)} style={{ color: 'var(--text)', ...style }} {...props}>
    {children}
  </h3>
);

export const CardContent: React.FC<CardProps> = ({ className, children, ...props }) => (
  <div className={cn("p-6", className)} {...props}>
    {children}
  </div>
);
