import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger' | 'outline' | 'destructive' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  isLoading, 
  className, 
  ...props 
}) => {
  const baseClasses = "inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none";
  
  const variants = {
    primary: "bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-2)] text-white shadow-glow hover:shadow-glow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]",
    secondary: "glass-light border border-[var(--color-border)] text-[var(--color-fg)] hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]",
    ghost: "bg-transparent text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)] hover:bg-[var(--glass-light-bg)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]",
    danger: "bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-500 hover:text-white hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]",
    destructive: "bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]",
    outline: "border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4.5 py-2 text-sm",
    lg: "px-6 py-3 text-base"
  };

  return (
    <button 
      className={cn(baseClasses, variants[variant], sizes[size], className)}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      )}
      {children}
    </button>
  );
};

