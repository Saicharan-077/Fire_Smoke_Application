import React from 'react';

interface SectionHeadingProps {
  title: string;
  subtitle?: string;
  badge?: string;
  highlightWord?: string;
  centered?: boolean;
  action?: React.ReactNode;
  className?: string;
}

export const SectionHeading: React.FC<SectionHeadingProps> = ({
  title,
  subtitle,
  badge,
  highlightWord,
  centered = false,
  action,
  className = '',
}) => {
  const renderTitle = () => {
    if (!highlightWord) {
      return title;
    }
    const parts = title.split(new RegExp(`(${highlightWord})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === highlightWord.toLowerCase() ? (
        <span key={i} className="gradient-text font-black">
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  return (
    <div
      className={`flex flex-col ${
        centered
          ? 'items-center text-center justify-center'
          : 'sm:flex-row sm:items-center justify-between'
      } gap-4 mb-6 ${className}`}
    >
      <div className={centered ? 'flex flex-col items-center max-w-2xl' : ''}>
        {badge && (
          <div className="mb-2.5">
            <span className="tech-badge shadow-sm">
              {badge}
            </span>
          </div>
        )}
        <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-[var(--color-fg)]">
          {renderTitle()}
        </h2>
        {subtitle && (
          <p className="text-sm text-[var(--color-muted)] mt-1.5 font-normal leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};

export default SectionHeading;

