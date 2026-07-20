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
      className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${enabled ? 'bg-emerald-800 text-emerald-600 hover:bg-emerald-700' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
    >
      {label}
    </button>
  );
}
