import React, { useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useLocations } from '../hooks/useLocations';
import { useQuickBooks } from '../hooks/useQuickBooks';
import type { ScanData, JournalLineItem } from '../../types';

interface Props {
  jwt: string;
  scanData: ScanData | null;
  selectedLocationId: string;
}

// Heuristic to determine posting type by field name
function getPostingType(field: string): 'Debit' | 'Credit' {
  const lower = field.toLowerCase();
  const debitFields = ['cash', 'credit card', 'debit card', 'gift card', 'discount', 'comp'];
  const creditFields = ['sales', 'revenue', 'tax', 'tip', 'gratuity'];
  if (debitFields.some((k) => lower.includes(k))) return 'Debit';
  if (creditFields.some((k) => lower.includes(k))) return 'Credit';
  return 'Debit';
}

function buildLines(scanData: ScanData): JournalLineItem[] {
  const lines: JournalLineItem[] = Object.entries(scanData)
    .filter(([, v]) => v !== 0)
    .map(([field, amount]) => ({
      amount: Math.abs(amount),
      postingType: getPostingType(field),
      accountRef: { value: field, name: field },
      description: field,
    }));

  const totalDebits = lines.filter((l) => l.postingType === 'Debit').reduce((s, l) => s + l.amount, 0);
  const totalCredits = lines.filter((l) => l.postingType === 'Credit').reduce((s, l) => s + l.amount, 0);
  const diff = Math.round((totalCredits - totalDebits) * 100) / 100;

  // Add balancing line if needed
  if (Math.abs(diff) > 0.001) {
    if (diff > 0) {
      lines.push({
        amount: diff,
        postingType: 'Debit',
        accountRef: { value: 'BALANCE', name: 'Balancing Account' },
        description: '(auto-balance)',
      });
    } else {
      lines.push({
        amount: Math.abs(diff),
        postingType: 'Credit',
        accountRef: { value: 'BALANCE', name: 'Balancing Account' },
        description: '(auto-balance)',
      });
    }
  }
  return lines;
}

export default function JournalEntryPreview({ jwt, scanData, selectedLocationId: _loc }: Props) {
  const { status, connect, checkStatus } = useQuickBooks(jwt);
  const { locations } = useLocations(jwt);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ id: string; txnDate: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lines = scanData ? buildLines(scanData) : [];
  const debits = lines.filter((l) => l.postingType === 'Debit');
  const credits = lines.filter((l) => l.postingType === 'Credit');
  const totalDebits = debits.reduce((s, l) => s + l.amount, 0);
  const totalCredits = credits.reduce((s, l) => s + l.amount, 0);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;

  const txnDate = new Date().toISOString().split('T')[0]!;

  const handleSync = useCallback(async () => {
    if (!scanData || !isBalanced) return;
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const result = await api.createJournalEntry(
        jwt,
        txnDate,
        lines,
        undefined,
        `Nest sync — ${txnDate} — ${locations[0]?.name ?? 'Unknown location'}`
      ) as { journalEntryId: string; txnDate: string };
      setSyncResult({ id: result.journalEntryId, txnDate: result.txnDate });
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [jwt, scanData, lines, isBalanced, txnDate, locations, checkStatus]);

  if (!scanData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <div className="text-3xl mb-3">📊</div>
        <p className="text-gray-400 text-sm">No scan data available</p>
        <p className="text-gray-600 text-xs mt-1">Go to the Scan tab first</p>
      </div>
    );
  }

  return (
    <div className="p-3">
      {/* QB Status */}
      <div className={`flex items-center justify-between px-3 py-2 rounded-lg mb-3 text-xs ${
        status.connected ? 'bg-green-900/30 border border-green-700' : 'bg-gray-800 border border-gray-600'
      }`}>
        <span className={status.connected ? 'text-green-400' : 'text-gray-400'}>
          {status.connected ? `✅ QB Connected — ${status.realmId}` : '⚠️ QuickBooks not connected'}
        </span>
        {!status.connected && (
          <button
            onClick={connect}
            className="text-xs text-cyan-400 hover:text-cyan-300 underline"
          >
            Connect
          </button>
        )}
      </div>

      {/* JE Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-400">Journal Entry Preview — {txnDate}</div>
        <div className={`text-xs px-2 py-0.5 rounded-full ${
          isBalanced ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
        }`}>
          {isBalanced ? 'Balanced ✓' : 'Unbalanced ✗'}
        </div>
      </div>

      {/* Lines table */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden mb-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left text-gray-500 px-3 py-1.5">Account</th>
              <th className="text-right text-gray-500 px-3 py-1.5">Debit</th>
              <th className="text-right text-gray-500 px-3 py-1.5">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="border-b border-gray-700/40">
                <td className="px-3 py-1.5 text-gray-300">{line.description ?? line.accountRef.name}</td>
                <td className="px-3 py-1.5 text-right font-mono text-blue-300">
                  {line.postingType === 'Debit' ? `$${line.amount.toFixed(2)}` : ''}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-emerald-300">
                  {line.postingType === 'Credit' ? `$${line.amount.toFixed(2)}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-700/30 font-bold">
              <td className="px-3 py-1.5 text-gray-400 text-xs">Total</td>
              <td className="px-3 py-1.5 text-right font-mono text-blue-400 text-xs">
                ${totalDebits.toFixed(2)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-emerald-400 text-xs">
                ${totalCredits.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {error && (
        <div className="mb-3 bg-red-900/40 border border-red-700 text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {syncResult && (
        <div className="mb-3 bg-green-900/40 border border-green-700 text-green-300 text-xs rounded-lg px-3 py-2">
          ✅ JE created — ID: {syncResult.id} ({syncResult.txnDate})
        </div>
      )}

      {/* Sync button */}
      <button
        onClick={handleSync}
        disabled={syncing || !status.connected || !isBalanced}
        className="w-full py-2.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-bold rounded-lg transition-colors"
      >
        {syncing
          ? 'Syncing to QuickBooks…'
          : !status.connected
          ? 'Connect QuickBooks first'
          : !isBalanced
          ? 'Journal Entry Unbalanced'
          : '⚡ Sync to QuickBooks'}
      </button>
    </div>
  );
}
