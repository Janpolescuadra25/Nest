import React from 'react';

interface Props {
  status: string;
  size?: 'sm' | 'md';
}

const STATUS_STYLES: Record<string, { label: string; classes: string }> = {
  active: { label: 'Active', classes: 'bg-emerald-50 text-emerald-600' },
  inactive: { label: 'Inactive', classes: 'bg-gray-200 text-gray-700' },
  disabled: { label: 'Disabled', classes: 'bg-red-50 text-red-600' },
  expired: { label: 'Expired', classes: 'bg-red-50 text-red-600' },
  pending: { label: 'Pending', classes: 'bg-amber-50 text-amber-600' },
  pending_approval: { label: 'Pending', classes: 'bg-amber-50 text-amber-600' },
  grace_period: { label: 'Grace', classes: 'bg-amber-50 text-amber-600' },
  time_bombed: { label: 'Restricted', classes: 'bg-red-50 text-red-600' },
  blocked: { label: 'Blocked', classes: 'bg-red-50 text-red-600' },
  syncing: { label: 'Syncing', classes: 'bg-emerald-50 text-emerald-600' },
  connected: { label: 'Connected', classes: 'bg-emerald-50 text-emerald-600' },
  disconnected: { label: 'Disconnected', classes: 'bg-gray-200 text-gray-700' },
};

function formatStatus(status: string): string {
  const normalized = status.trim().toLowerCase().replace(/\s+/g, '_');
  if (STATUS_STYLES[normalized]) return STATUS_STYLES[normalized].label;
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

export default function StatusBadge({ status, size = 'sm' }: Props) {
  const normalized = status.trim().toLowerCase().replace(/\s+/g, '_');
  const style = STATUS_STYLES[normalized] ?? { label: formatStatus(status), classes: 'bg-gray-200 text-gray-700' };
  const sizeClasses = size === 'md' ? 'text-[11px] px-2 py-1.5' : 'text-[11px] px-1.5 py-0.5';

  return (
    <span className={`rounded ${sizeClasses} ${style.classes}`}>{style.label}</span>
  );
}
