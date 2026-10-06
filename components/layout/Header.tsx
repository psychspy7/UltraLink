'use client';

import React from 'react';

interface HeaderProps {
  title: string;
  subtitle: string;
  badge?: string;
  actions?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  badge,
  actions,
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-cyan-500/10 mb-6">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-100">
            {title}
          </h1>
          {badge && (
            <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-500/30">
              {badge}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-400 max-w-2xl">{subtitle}</p>
      </div>
      {actions && <div className="flex items-center gap-2 self-start sm:self-center">{actions}</div>}
    </div>
  );
};

export default Header;
