import type { ScanHealth } from '../../types';
import { relativeTime } from '../lib/utils';

interface ScannerHealthCardProps {
  scanHealth: ScanHealth;
}

export function ScannerHealthCard({ scanHealth }: ScannerHealthCardProps) {
  const statusLabel = scanHealth.totalScans === 0
    ? '⚪ No Data'
    : scanHealth.successRate >= 80
      ? '🟢 Healthy'
      : scanHealth.successRate >= 50
        ? '🟡 Warning'
        : '🔴 Critical';

  const badgeClass = scanHealth.totalScans === 0
    ? 'bg-slate-900 text-slate-300'
    : scanHealth.successRate >= 80
      ? 'bg-emerald-900 text-emerald-300'
      : scanHealth.successRate >= 50
        ? 'bg-amber-900 text-amber-300'
        : 'bg-red-900 text-red-300';

  const barClass = scanHealth.successRate >= 80
    ? 'bg-emerald-500'
    : scanHealth.successRate >= 50
      ? 'bg-amber-500'
      : 'bg-red-500';

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-cyan-300">Scanner Health</h3>
        <span className={`text-[11px] px-2 py-1 rounded ${badgeClass}`}>{statusLabel}</span>
      </div>
      <div className="text-sm text-gray-300">Last scan: {scanHealth.lastScanAt ? relativeTime(scanHealth.lastScanAt) : 'Never'}</div>
      <div className="h-3 bg-slate-900 rounded overflow-hidden">
        <div
          className={`h-full rounded ${barClass}`}
          style={{ width: `${Math.min(100, Math.max(0, scanHealth.successRate))}%` }}
        />
      </div>
      <div className="text-xs text-gray-400">
        {scanHealth.successRate.toFixed(1)}% success · {scanHealth.successfulScans} synced / {scanHealth.totalScans} total scans
      </div>
    </div>
  );
}
