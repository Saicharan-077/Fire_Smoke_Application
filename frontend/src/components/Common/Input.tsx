import React from 'react';
import { cn } from './Button';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, label, error, ...props }, ref) => {
  return (
    <div className="w-full">
      {label && <label className="block text-xs font-bold text-[var(--color-muted)] uppercase tracking-wider mb-1.5">{label}</label>}
      <input 
        ref={ref}
        className={cn("w-full glass-light border border-[var(--color-border)] rounded-xl px-4 py-2.5 text-sm text-[var(--color-fg)] placeholder-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all font-semibold shadow-sm", error && "border-red-500 focus:border-red-500 focus:ring-red-500/20", className)}
        {...props}
      />
      {error && <p className="mt-1.5 text-xs font-semibold text-red-500">{error}</p>}
    </div>
  );
});
Input.displayName = 'Input';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { label: string; value: string | number }[];
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, label, options, ...props }, ref) => {
  return (
    <div className="w-full">
      {label && <label className="block text-xs font-bold text-[var(--color-muted)] uppercase tracking-wider mb-1.5">{label}</label>}
      <select 
        ref={ref}
        className={cn("w-full appearance-none glass-light border border-[var(--color-border)] rounded-xl px-4 py-2.5 pr-10 text-sm text-[var(--color-fg)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all cursor-pointer font-semibold shadow-sm bg-[var(--color-surface)]", className)}
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239CA3AF' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
          backgroundPosition: 'right 0.75rem center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '1.25em 1.25em'
        }}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-[var(--color-surface)] text-[var(--color-fg)] font-semibold">{opt.label}</option>
        ))}
      </select>
    </div>
  );
});
Select.displayName = 'Select';

export default Input;
