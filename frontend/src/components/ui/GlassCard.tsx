import React from 'react';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  gradientBorder?: boolean;
  hoverEffect?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  gradientBorder = false,
  hoverEffect = true,
  ...props
}) => {
  return (
    <div
      className={`glass rounded-2xl overflow-hidden border border-[var(--color-border)] ${
        hoverEffect ? 'card-hover' : ''
      } ${className}`}
      {...props}
    >
      {gradientBorder && (
        <div className="h-1 bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-accent-2)] to-[var(--color-accent-3)]" />
      )}
      {children}
    </div>
  );
};

export default GlassCard;
