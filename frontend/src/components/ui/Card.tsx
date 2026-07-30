'use client';

import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
}

export function Card({ children, className = '', padding = true }: CardProps) {
  return (
    <div
      className={[
        'rounded-lg border border-gray-700 bg-gray-800',
        padding ? 'p-6' : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function CardHeader({ title, subtitle, action }: CardHeaderProps) {
  return (
    <div className="mb-4 flex items-start justify-between">
      <div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-gray-400">{subtitle}</p>}
      </div>
      {action && <div className="ml-4 shrink-0">{action}</div>}
    </div>
  );
}
