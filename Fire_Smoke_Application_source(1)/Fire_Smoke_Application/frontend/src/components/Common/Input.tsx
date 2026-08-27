import React, { useId } from 'react';
import { cn } from './Button';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, label, error, id, ...props }, ref) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  return (
    <div className="w-full">
      {label && <label htmlFor={inputId} className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-2)' }}>{label}</label>}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus-visible:ring-2 transition-shadow",
          "bg-[var(--surface)] border-[var(--border-2)] text-[var(--text)] placeholder-[var(--muted-2)] focus-visible:ring-[var(--primary)]/20 focus-visible:border-[var(--primary)]",
          error && "border-[var(--fire)] focus-visible:border-[var(--fire)] focus-visible:ring-[var(--fire)]/20",
          className
        )}
        {...props}
      />
      {error && <p id={errorId} role="alert" className="mt-1.5 text-sm" style={{ color: 'var(--fire-text)' }}>{error}</p>}
    </div>
  );
});
Input.displayName = 'Input';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { label: string; value: string | number }[];
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, label, options, id, ...props }, ref) => {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className="w-full">
      {label && <label htmlFor={selectId} className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-2)' }}>{label}</label>}
      <select
        ref={ref}
        id={selectId}
        className={cn(
          "w-full appearance-none border rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-none focus-visible:ring-2 transition-shadow",
          "bg-[var(--surface)] border-[var(--border-2)] text-[var(--text)] focus-visible:ring-[var(--primary)]/20 focus-visible:border-[var(--primary)]",
          className
        )}
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
          backgroundPosition: 'right 0.75rem center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '1.25em 1.25em'
        }}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
});
Select.displayName = 'Select';
