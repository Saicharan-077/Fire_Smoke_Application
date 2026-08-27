import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from './Button';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, className }) => {
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md animate-fade-in" onClick={onClose} />
      <div className={cn("relative w-full max-w-lg glass-heavy border border-[var(--color-border)] rounded-2xl shadow-premium animate-slide-up overflow-hidden text-[var(--color-fg)] font-sans", className)}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] bg-[var(--glass-light-bg)]">
          <h2 className="text-xl font-bold text-[var(--color-fg)]">{title}</h2>
          <button onClick={onClose} className="p-2 rounded-xl text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--glass-light-bg)] transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
        {footer && (
          <div className="px-6 py-4 border-t border-[var(--color-border)] bg-[var(--glass-light-bg)] flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
