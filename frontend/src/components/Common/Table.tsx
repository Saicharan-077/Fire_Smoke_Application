import React from 'react';
import { cn } from './Button';

interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {}

export const Table: React.FC<TableProps> = ({ className, children, ...props }) => {
  return (
    <div className="w-full overflow-x-auto custom-scrollbar">
      <table className={cn("w-full text-left border-collapse", className)} {...props}>
        {children}
      </table>
    </div>
  );
};

export const TableHeader: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className, children, ...props }) => (
  <thead className={cn("bg-[var(--glass-light-bg)] border-b border-[var(--color-border)] sticky top-0 backdrop-blur-md z-10", className)} {...props}>
    {children}
  </thead>
);

export const TableBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className, children, ...props }) => (
  <tbody className={cn("divide-y divide-[var(--color-border)]", className)} {...props}>
    {children}
  </tbody>
);

export const TableRow: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({ className, children, ...props }) => (
  <tr className={cn("hover:bg-[var(--glass-light-bg)] transition-colors group", className)} {...props}>
    {children}
  </tr>
);

export const TableHead: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({ className, children, ...props }) => (
  <th className={cn("px-6 py-4 text-xs font-bold text-[var(--color-muted)] uppercase tracking-wider whitespace-nowrap", className)} {...props}>
    {children}
  </th>
);

export const TableCell: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ className, children, ...props }) => (
  <td className={cn("px-6 py-4 whitespace-nowrap text-sm text-[var(--color-fg-secondary)] group-hover:text-[var(--color-fg)] transition-colors font-medium", className)} {...props}>
    {children}
  </td>
);

