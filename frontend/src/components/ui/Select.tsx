'use client';

import React from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  placeholder?: string;
  error?: string;
  hint?: string;
}

export function Select({
  label,
  options,
  placeholder,
  error,
  hint,
  id,
  className = '',
  ...props
}: SelectProps) {
  const selectId = id ?? label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="space-y-1">
      <label htmlFor={selectId} className="block text-sm font-medium text-gray-300">
        {label}
        {props.required && <span className="ml-1 text-red-400">*</span>}
      </label>
      <select
        id={selectId}
        className={[
          'block w-full rounded-md border bg-gray-900 px-3 py-2 text-sm text-white',
          'transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500',
          error
            ? 'border-red-500 focus:ring-red-500'
            : 'border-gray-600 hover:border-gray-500',
          className,
        ].join(' ')}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
