import React from 'react';

interface Props {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export default function ToggleRow({ label, description, enabled, onToggle, disabled }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className="w-full flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4 text-left transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-70"
      aria-pressed={enabled}
    >
      <div>
        <div className="text-sm font-medium text-gray-900">{label}</div>
        <div className="text-xs text-gray-500 mt-1">{description}</div>
      </div>
      <div className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${enabled ? 'bg-emerald-600' : 'bg-gray-300'}`}>
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
      </div>
    </button>
  );
}
