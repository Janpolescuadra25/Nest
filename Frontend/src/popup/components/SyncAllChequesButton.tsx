import React, { useState } from 'react';
import { useQBContext } from '../contexts/QBContext';
import { useToast } from './Toast';
import { api } from '../lib/api';
import { buildChequePayload } from '../lib/batch-payload-builder';
import type { ScanEntry, Template, ScanData, BatchSyncItem } from '../../types';

interface Props {
  jwt: string;
  scanEntries: ScanEntry[];
  selectedTemplate: Template | null;
  selectedLocationId: string;
}

const SyncAllChequesButton = ({ jwt, scanEntries, selectedTemplate, selectedLocationId }: Props) => {
  const { accounts, customers, vendors, taxCodes } = useQBContext();
  const { showToast } = useToast();
  const [batchSyncing, setBatchSyncing] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');
  const [summaryText, setSummaryText] = useState('');

  const handleSyncAllCheques = async () => {
    if (!selectedTemplate) {
      showToast('Please select a template before syncing cheques.', 'error');
      return;
    }

    if (!selectedLocationId) {
      showToast('Location is required to sync cheques.', 'error');
      return;
    }

    setBatchSyncing(true);
    setSummaryText('');
    setBatchProgress('Building cheque payloads...');

    try {
      const mappings = await api.getMappings(jwt, selectedLocationId);
      const valueMappings = await api.getValueMappings(jwt, selectedTemplate.id);
      const items: BatchSyncItem[] = [];
      let skippedCount = 0;

      for (const entry of scanEntries) {
        const payload = buildChequePayload({
          scanRecordId: entry.scanRecordId ?? '',
          scanData: {} as ScanData,
          mappings,
          accounts,
          customers,
          vendors,
          taxCodes,
          txnDate: entry.header?.paymentDate ?? new Date().toISOString().slice(0, 10),
          defaults: selectedTemplate.defaults as Record<string, { value: string; name?: string } | null>,
          scanEntry: entry,
          valueMappings,
        });

        if (payload) {
          items.push(payload);
        } else {
          skippedCount += 1;
        }
      }

      if (items.length === 0) {
        showToast('No valid cheque payloads could be built.', 'error');
        setBatchProgress('');
        return;
      }

      setBatchProgress(`Syncing ${items.length} cheque${items.length !== 1 ? 's' : ''}...`);

      const { results, summary } = await api.syncBatch(jwt, items);
      setBatchProgress('');
      setSummaryText(`${summary.synced} synced, ${summary.skipped} skipped, ${summary.failed} failed.`);

      showToast(
        `${summary.synced} synced, ${summary.skipped} skipped, ${summary.failed} failed`,
        summary.failed > 0 ? 'error' : 'success',
      );

      const hasAuthFailure = results.some((r) => r.status === 'FAILED' && r.errorType === 'AUTH');
      if (hasAuthFailure) {
        showToast('QuickBooks connection expired. Please reconnect.', 'error');
      }

      if (skippedCount > 0) {
        showToast(`${skippedCount} cheque${skippedCount !== 1 ? 's' : ''} skipped because they had no valid mapped lines.`, 'info');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Sync All Cheques failed', 'error');
      setBatchProgress('');
    } finally {
      setBatchSyncing(false);
    }
  };

  return (
    <div className="mb-6 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900">Batch Sync</div>
          <div className="text-sm text-gray-600">Sync all cheque preview entries in one batch.</div>
        </div>
        <button
          type="button"
          onClick={handleSyncAllCheques}
          disabled={batchSyncing}
          className="inline-flex items-center justify-center rounded-lg bg-emerald-700 px-6 py-2 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {batchSyncing ? 'Syncing...' : 'Sync All Cheques'}
        </button>
      </div>
      {batchProgress && <div className="mt-3 text-sm text-gray-500">{batchProgress}</div>}
      {summaryText && <div className="mt-2 text-sm text-gray-700">{summaryText}</div>}
    </div>
  );
};

export default SyncAllChequesButton;
