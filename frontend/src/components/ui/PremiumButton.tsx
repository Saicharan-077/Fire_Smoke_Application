import React from 'react';
import { motion } from 'framer-motion';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';

interface PremiumButtonProps extends React.ComponentProps<typeof motion.button> {
  variant?: ButtonVariant;
  children: React.ReactNode;
  icon?: React.ReactNode;
  loading?: boolean;
  className?: string;
  disabled?: boolean;
}

export const PremiumButton: React.FC<PremiumButtonProps> = ({
  variant = 'primary',
  children,
  icon,
  loading = false,
  className = '',
  disabled = false,
  ...props
}) => {
  const baseStyles = "inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed select-none cursor-pointer";
  
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-2)] text-white shadow-glow hover:shadow-glow-lg hover:scale-[1.02] active:scale-[0.98]",
    secondary: "glass-light border border-[var(--color-border)] text-[var(--color-fg)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)] hover:scale-[1.02] active:scale-[0.98]",
    outline: "border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 hover:scale-[1.02] active:scale-[0.98]",
    ghost: "text-[var(--color-fg-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
    danger: "bg-gradient-to-r from-red-600 to-rose-700 text-white shadow-[0_0_20px_rgba(239,68,68,0.3)] hover:scale-[1.02] active:scale-[0.98]",
    success: "bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:scale-[1.02] active:scale-[0.98]",
  };

  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      className={`${baseStyles} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      <span>{children}</span>
    </motion.button>
  );
};

export default PremiumButton;
