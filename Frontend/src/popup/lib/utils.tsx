import type { ReactNode } from 'react';

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function relativeTime(dateString: string | null | undefined): string {
  if (dateString == null) {
    return 'Never';
  }

  const date = new Date(dateString);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) {
    return '-';
  }

  const now = Date.now();
  const diffMs = now - timestamp;
  const seconds = Math.floor(diffMs / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return MONTH_FORMATTER.format(date);

  return FULL_DATE_FORMATTER.format(date);
}

export function formatAction(action: string): string {
  const mapping: Record<string, string> = {
    ADMIN_APPROVED: 'Approved admin',
    ADMIN_REJECTED: 'Rejected admin',
    ADMIN_UPDATED: 'Updated admin',
    USER_INVITED: 'Invited user',
    ROLE_CHANGED: 'Changed role',
    PERMISSION_UPDATED: 'Updated permissions',
    TIMEBOMB_SET: 'Set trial expiration',
    USER_STATUS_CHANGED: 'Changed user status',
    USER_DISABLED: 'Disabled user',
    SCAN_SUBMITTED: 'Submitted scan',
    SCAN_SYNCED: 'Synced scan',
    SCAN_FAILED: 'Scan failed',
  };

  return mapping[action] ?? action
    .toLowerCase()
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function trialCountdown(expiresAt: string | null | undefined): ReactNode {
  if (!expiresAt) {
    return <span className="text-xs text-gray-600 font-medium">No trial set</span>;
  }

  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) {
    return <span className="text-xs text-gray-600 font-medium">Invalid date</span>;
  }

  const now = Date.now();
  const diffMs = expiry - now;
  if (diffMs <= 0) {
    return <span className="text-xs text-red-600 font-medium">EXPIRED</span>;
  }

  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const color = days <= 3 ? 'text-red-600' : days <= 7 ? 'text-orange-400' : 'text-emerald-600';
  return <span className={`text-xs font-medium ${color}`}>{days}d left</span>;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
