import React from 'react';

interface Props {
  feature: string;
  action: string;
  enabled: boolean;
  disabled?: boolean;
  onChange: (feature: string, action: string, enabled: boolean) => void;
}

function formatLabel(feature: string, action: string) {
  const format = (value: string) => value
    .replace(/(^|\s|-|_)(\w)/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
    .replace(/_/g, ' ');

  return `${format(feature)}: ${format(action)}`;
}

export default function PermissionToggle({ feature, action, enabled, disabled, onChange }: Props) {
  const label = formatLabel(feature, action);

  return (
    <button
      type="button"
      onClick={() => onChange(feature, action, !enabled)}
      disabled={disabled}
      className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${enabled ? 'bg-cyan-800 text-cyan-300 hover:bg-cyan-700' : 'bg-slate-700 text-gray-500 hover:bg-slate-600'}`}
    >
      {label}
    </button>
  );
}
