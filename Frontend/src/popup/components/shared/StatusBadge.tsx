import React from 'react';

interface Props {
  status: string;
  size?: 'sm' | 'md';
}

const STATUS_STYLES: Record<string, { label: string; classes: string }> = {
  active: { label: 'Active', classes: 'bg-green-900 text-green-400' },
  inactive: { label: 'Inactive', classes: 'bg-gray-700 text-gray-400' },
  disabled: { label: 'Disabled', classes: 'bg-red-900 text-red-400' },
  expired: { label: 'Expired', classes: 'bg-red-900 text-red-400' },
  pending: { label: 'Pending', classes: 'bg-yellow-900 text-yellow-400' },
  pending_approval: { label: 'Pending', classes: 'bg-yellow-900 text-yellow-400' },
  grace_period: { label: 'Grace', classes: 'bg-yellow-900 text-yellow-300' },
  time_bombed: { label: 'Restricted', classes: 'bg-red-900 text-red-300' },
  blocked: { label: 'Blocked', classes: 'bg-red-900 text-red-300' },
  syncing: { label: 'Syncing', classes: 'bg-blue-900 text-blue-300' },
  connected: { label: 'Connected', classes: 'bg-green-900 text-green-300' },
  disconnected: { label: 'Disconnected', classes: 'bg-gray-700 text-gray-400' },
};

function formatStatus(status: string): string {
  const normalized = status.trim().toLowerCase().replace(/\s+/g, '_');
  if (STATUS_STYLES[normalized]) return STATUS_STYLES[normalized].label;
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

export default function StatusBadge({ status, size = 'sm' }: Props) {
  const normalized = status.trim().toLowerCase().replace(/\s+/g, '_');
  const style = STATUS_STYLES[normalized] ?? { label: formatStatus(status), classes: 'bg-gray-700 text-gray-400' };
  const sizeClasses = size === 'md' ? 'text-[11px] px-2 py-1.5' : 'text-[11px] px-1.5 py-0.5';

  return (
    <span className={`rounded ${sizeClasses} ${style.classes}`}>{style.label}</span>
  );
}
