'use client';

import React from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' };

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <svg
      className={['animate-spin text-indigo-400', SIZE_CLASSES[size], className].join(' ')}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Loading"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

export function PageSpinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

interface ErrorMessageProps {
  message: string;
  className?: string;
}

export function ErrorMessage({ message, className = '' }: ErrorMessageProps) {
  return (
    <div
      className={[
        'rounded-md border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-300',
        className,
      ].join(' ')}
    >
      {message}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-700 py-12 text-center">
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}
