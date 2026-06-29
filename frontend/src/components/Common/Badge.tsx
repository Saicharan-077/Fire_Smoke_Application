import React from 'react';
import { cn } from './Button';

interface BadgeProps {
  type?: 'fire' | 'smoke' | 'safe' | 'active' | 'resolved' | 'default' | 'danger';
  children: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ type = 'default', children, className }) => {
  const variants = {
    fire: "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20",
    smoke: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/20",
    safe: "bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/20",
    active: "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20",
    resolved: "bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/20",
    danger: "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20",
    default: "bg-gray-500/15 text-gray-700 dark:text-gray-300 border border-gray-500/20",
  };

  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider", variants[type], className)}>
      {children}
    </span>
  );
};
