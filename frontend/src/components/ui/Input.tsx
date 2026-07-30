'use client';

import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, id, className = '', ...props }: InputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-300">
        {label}
        {props.required && <span className="ml-1 text-red-400">*</span>}
      </label>
      <input
        id={inputId}
        className={[
          'block w-full rounded-md border bg-gray-900 px-3 py-2 text-sm text-white',
          'placeholder-gray-500 transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500',
          error
            ? 'border-red-500 focus:ring-red-500'
            : 'border-gray-600 hover:border-gray-500',
          className,
        ].join(' ')}
        {...props}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function Textarea({ label, error, hint, id, className = '', ...props }: TextareaProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-300">
        {label}
        {props.required && <span className="ml-1 text-red-400">*</span>}
      </label>
      <textarea
        id={inputId}
        rows={3}
        className={[
          'block w-full rounded-md border bg-gray-900 px-3 py-2 text-sm text-white',
          'placeholder-gray-500 transition-colors resize-none',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500',
          error
            ? 'border-red-500 focus:ring-red-500'
            : 'border-gray-600 hover:border-gray-500',
          className,
        ].join(' ')}
        {...props}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
