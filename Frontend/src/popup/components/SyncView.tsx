import React, { useState, useEffect } from 'react';
import { api, ApiError } from '../lib/api';
import { useLocations } from '../hooks/useLocations';
import { useQuickBooks } from '../hooks/useQuickBooks';
import { useQBContext } from '../contexts/QBContext';
import { useToast } from './Toast';
import ConfirmDialog from './shared/ConfirmDialog';
import { buildJEPayload } from '../lib/je-builder';
import { buildBillLikePayload, buildChequePayload } from '../lib/batch-payload-builder';
import type { BatchSyncItem, ScanRecord, ScanEntry, ValueMapping } from '../../types';
import { TRANSACTION_TYPE_LABELS } from '../../types';

const STATUS_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'MAPPED', label: 'Mapped' },
  { value: 'PENDING_APPROVAL', label: 'For Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'SYNCED', label: 'Synced' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'REJECTED', label: 'Rejected' },
];

interface Props {
  jwt: string;
  selectedLocationId: string;
  onLocationChange: (id: string) => void;
  onTabChange?: (tab: string) => void;
  onScanRecordId?: (id: string) => void;
  onboardingStep?: number;
  onHasSynced?: () => void;
  userRole: string;
  mode?: 'review' | 'approved' | 'sync-history';
}

const STATUS_CLASSES: Record<string, string> = {
  SYNCED: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  FAILED: 'text-red-600 bg-red-50 border-red-200',
  PENDING: 'text-amber-600 bg-amber-50 border-amber-200',
  MAPPED: 'text-emerald-400 bg-emerald-50 border-emerald-200',
  PENDING_APPROVAL: 'text-blue-600 bg-blue-50 border-blue-200',
  APPROVED: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  REJECTED: 'text-red-500 bg-red-50 border-red-200',
};

export default function SyncView({ jwt, selectedLocationId, onLocationChange, onTabChange, onScanRecordId, onboardingStep = 0, onHasSynced, userRole, mode }: Props) {
  const { locations } = useLocations(jwt);
  const { status } = useQuickBooks(jwt);
  const { accounts, customers, vendors, taxCodes, terms } = useQBContext();
  const { showToast } = useToast();
  const locationId = selectedLocationId || locations[0]?.id || '';
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [batchSyncing, setBatchSyncing] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');
  const [isRetryingId, setIsRetryingId] = useState<string | null>(null);
  const [isRetryingAll, setIsRetryingAll] = useState(false);
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const [selectedScanIds, setSelectedScanIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [expandedScanId, setExpandedScanId] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'review') {
      setStatusFilter('PENDING_APPROVAL');
    } else if (mode === 'approved') {
      setStatusFilter('APPROVED');
    } else if (mode === 'sync-history') {
      setStatusFilter('SYNCED');
    } else {
      setStatusFilter('ALL');
    }
  }, [mode]);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId) return;
    setLoading(true);
    setError(null);
    setScans([]);
    setPage(1);
    setHasMore(false);
    setSourceFilter('all');
    setExpandedScanId(null);
    api.getScans(jwt, locationId, 1)
      .then((data) => { setScans(data.scans ?? []); setHasMore(data.hasMore ?? false); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sync history'))
      .finally(() => setLoading(false));
  }, [jwt, locationId]);

  const loadMore = () => {
    if (loading || !hasMore) return;
    const nextPage = page + 1;
    setLoading(true);
    api.getScans(jwt, locationId, nextPage)
      .then((data) => { setScans(prev => [...prev, ...(data.scans ?? [])]); setHasMore(data.hasMore ?? false); setPage(nextPage); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load more'))
      .finally(() => setLoading(false));
  };

  const refreshScans = async () => {
    const { scans: freshScans, hasMore: freshMore } = await api.getScans(jwt, locationId, 1);
    setScans(freshScans ?? []);
    setHasMore(freshMore ?? false);
    setPage(1);
  };

  const handleRetryScan = async (scanId: string) => {
    setIsRetryingId(scanId);
    try {
      const result = await api.retryScan(jwt, scanId);
      const scan = scans.find(s => s.id === scanId);
      const syncType = scan?.syncLogs?.[0]?.syncType;
      const label = syncType ? (TRANSACTION_TYPE_LABELS[syncType] ?? 'Transaction') : 'Transaction';

      showToast(
        `Retry succeeded — ${label} ${result.docNumber ?? result.qbJournalEntryId ?? 'created'} (attempt ${result.attemptCount})`,
        'success',
      );
      await refreshScans();
    } catch (err) {
      if (err instanceof ApiError) {
        const attemptCount = err.payload?.attemptCount;
        const message = `${err.message}${attemptCount ? ` (attempt ${attemptCount}/3)` : ''}`;
        showToast(message, 'error');
      } else {
        showToast(err instanceof Error ? err.message : 'Retry error', 'error');
      }
    } finally {
      setIsRetryingId(null);
    }
  };

  const handleRetryAllFailed = async () => {
    setIsRetryingAll(true);
    try {
      const { summary } = await api.retryBatch(jwt, { locationId });
      showToast(
        `Retry complete — ${summary.succeeded} succeeded, ${summary.failed} failed, ${summary.skipped} skipped`,
        summary.failed > 0 ? 'error' : 'success',
      );
      await refreshScans();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Batch retry failed', 'error');
    } finally {
      setIsRetryingAll(false);
    }
  };

  const clearSelectedScans = () => setSelectedScanIds(new Set());

  const handleSyncSelected = async () => {
    if (selectedScanIds.size === 0) return;

    setBatchSyncing(true);
    setBatchProgress('Preparing...');
    try {
      const isAdminOrOwner = userRole === 'ADMIN' || userRole === 'OWNER';
      const allPending: ScanRecord[] = [];
      let fetchPage = 1;
      let fetchMore = true;
      while (fetchMore) {
        if (fetchPage > 100) break;
        const { scans: pageScans, hasMore: more } = await api.getScans(jwt, locationId, fetchPage, 100);
        allPending.push(...(pageScans ?? []).filter((s) =>
          isAdminOrOwner
            ? (s.status === 'PENDING' || s.status === 'MAPPED')
            : s.status === 'APPROVED'
        ));
        fetchMore = more;
        fetchPage++;
      }

      const mappings = await api.getMappings(jwt, locationId);
      const templates = await api.getTemplates(jwt, locationId);
      const valueMappingsByTemplate = new Map<string, ValueMapping[]>();
      await Promise.all(
        templates.map(async (template) => {
          const valueMappings = await api.getValueMappings(jwt, template.id);
          valueMappingsByTemplate.set(template.id, valueMappings ?? []);
        }),
      );
      const journalEntryTemplate = templates.find((t) => t.transactionType === 'JOURNAL_ENTRY' && t.isActive);

      const selectedScans = allPending.filter((scan) => selectedScanIds.has(scan.id));
      const skippedReasons: { type: string; reason: string; count: number }[] = [];
      const skippedWarnings: string[] = [];
      const items: BatchSyncItem[] = [];

      for (const scan of selectedScans) {
        const txnType = (scan.transactionType ?? 'JOURNAL_ENTRY').toUpperCase();
        const sharedScanEntry = scan.source && scan.source !== 'pos' && scan.rawScanEntry ? scan.rawScanEntry as ScanEntry : undefined;

        if (txnType === 'JOURNAL_ENTRY') {
          const payload = buildJEPayload({
            scanRecordId: scan.id,
            scanData: scan.rawData,
            mappings,
            accounts,
            txnDate: scan.scanDate.slice(0, 10),
            scanEntry: sharedScanEntry,
            valueMappings: journalEntryTemplate ? valueMappingsByTemplate.get(journalEntryTemplate.id) ?? [] : [],
          });

          if (payload.lines.length > 0) {
            if (!payload.balanced) {
              skippedWarnings.push(
                `Skipped unbalanced entry (Debits: $${payload.totalDebits.toFixed(2)}, Credits: $${payload.totalCredits.toFixed(2)}, Diff: $${payload.imbalanceAmount.toFixed(2)})`,
              );
            } else {
              items.push({ ...payload, transactionType: 'JOURNAL_ENTRY' });
            }
          } else {
            const reason = 'no mapped line items';
            const existing = skippedReasons.find((s) => s.type === txnType && s.reason === reason);
            if (existing) { existing.count++; } else { skippedReasons.push({ type: txnType, reason, count: 1 }); }
          }
          continue;
        }

        if (txnType === 'BILL' || txnType === 'VENDOR_CREDIT') {
          const template = templates.find((t) => t.transactionType === txnType && t.isActive);
          if (!template?.defaults || !template.defaults.vendorRef || !template.defaults.apAccountRef) {
            const reason = 'missing header defaults (set up in Mapping tab)';
            const existing = skippedReasons.find((s) => s.type === txnType && s.reason === reason);
            if (existing) { existing.count++; } else { skippedReasons.push({ type: txnType, reason, count: 1 }); }
            continue;
          }

          const payload = buildBillLikePayload({
            scanRecordId: scan.id,
            transactionType: txnType as 'BILL' | 'VENDOR_CREDIT',
            scanData: scan.rawData,
            mappings,
            accounts,
            vendors,
            terms,
            taxCodes,
            txnDate: scan.scanDate.slice(0, 10),
            defaults: template.defaults as Record<string, { value: string; name?: string } | null>,
            scanEntry: sharedScanEntry,
            valueMappings: valueMappingsByTemplate.get(template.id) ?? [],
          });

          if (payload) {
            items.push(payload);
          } else {
            const reason = 'no mapped line items';
            const existing = skippedReasons.find((s) => s.type === txnType && s.reason === reason);
            if (existing) { existing.count++; } else { skippedReasons.push({ type: txnType, reason, count: 1 }); }
          }
          continue;
        }

        if (txnType === 'CHEQUE') {
          const template = templates.find((t) => t.transactionType === 'CHEQUE' && t.isActive);
          if (!template?.defaults || !template.defaults.bankAccountRef || !template.defaults.payeeRef) {
            const reason = 'missing header defaults (set up in Mapping tab)';
            const existing = skippedReasons.find((s) => s.type === txnType && s.reason === reason);
            if (existing) { existing.count++; } else { skippedReasons.push({ type: txnType, reason, count: 1 }); }
            continue;
          }

          const payload = buildChequePayload({
            scanRecordId: scan.id,
            scanData: scan.rawData,
            mappings,
            accounts,
            customers,
            vendors,
            taxCodes,
            txnDate: scan.scanDate.slice(0, 10),
            defaults: template.defaults as Record<string, { value: string; name?: string } | null>,
            scanEntry: sharedScanEntry,
            valueMappings: valueMappingsByTemplate.get(template.id) ?? [],
          });

          if (payload) {
            items.push(payload);
          } else {
            const reason = 'no mapped line items';
            const existing = skippedReasons.find((s) => s.type === txnType && s.reason === reason);
            if (existing) { existing.count++; } else { skippedReasons.push({ type: txnType, reason, count: 1 }); }
          }
          continue;
        }
      }

      if (skippedWarnings.length > 0) {
        showToast(
          `[Batch Sync] Skipped ${skippedWarnings.length} unbalanced entries. Review them individually.`,
          'error',
        );
      }

      for (const skip of skippedReasons) {
        const label = TRANSACTION_TYPE_LABELS[skip.type as keyof typeof TRANSACTION_TYPE_LABELS] ?? skip.type;
        showToast(`${skip.count} ${label} scan(s) skipped — ${skip.reason}`, 'info');
      }

      if (items.length === 0) {
        if (skippedReasons.length === 0) {
          showToast('No selected scans to sync', 'info');
        }
        return;
      }

      setBatchProgress(`Syncing ${items.length} scan${items.length !== 1 ? 's' : ''}...`);

      const { results, summary } = await api.syncBatch(jwt, items);

      const hasAuthFailure = results.some((r) => r.status === 'FAILED' && r.errorType === 'AUTH');
      showToast(
        `${summary.synced} synced, ${summary.skipped} skipped, ${summary.failed} failed`,
        summary.failed > 0 ? 'error' : 'success',
      );
      if (hasAuthFailure) {
        showToast('QuickBooks connection expired. Please reconnect.', 'error');
      }

      clearSelectedScans();
      await refreshScans();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Batch sync failed', 'error');
    } finally {
      setBatchSyncing(false);
      setBatchProgress('');
    }
  };

  const handleDeleteSelected = async () => {
    try {
      await api.bulkDeleteScans(jwt, [...selectedScanIds]);
      setShowDeleteConfirm(false);
      clearSelectedScans();
      await refreshScans();
      showToast(`Deleted ${selectedScanIds.size} selected scan${selectedScanIds.size !== 1 ? 's' : ''}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  const handleApprove = async (scanId: string) => {
    setApprovingId(scanId);
    try {
      await api.approveScan(jwt, scanId);
      showToast('Scan approved', 'success');
      await refreshScans();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Approval failed', 'error');
    } finally {
      setApprovingId(null);
    }
  };

  const showApprovalActions = mode === undefined || mode === 'review';

  const handleReject = async (scanId: string) => {
    setRejectingId(scanId);
    try {
      await api.rejectScan(jwt, scanId);
      showToast('Scan rejected', 'success');
      await refreshScans();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Rejection failed', 'error');
    } finally {
      setRejectingId(null);
    }
  };

  const getScanAttention = (scan: ScanRecord): 'stale' | 'max-retried' | 'old-failure' | null => {
    if (scan.status === 'PENDING' || scan.status === 'MAPPED') {
      const scanAge = Date.now() - new Date(scan.scanDate).getTime();
      if (scanAge > 24 * 60 * 60 * 1000) return 'stale';
    }
    if (scan.status === 'FAILED') {
      const latestLog = scan.syncLogs?.slice().sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime())[0];
      if (latestLog?.attemptCount && latestLog.attemptCount >= 3) return 'max-retried';
      if (latestLog) {
        const failureAge = Date.now() - new Date(latestLog.syncedAt).getTime();
        if (failureAge > 24 * 60 * 60 * 1000) return 'old-failure';
      }
    }
    return null;
  };

  const handleSyncAll = async () => {
    setBatchSyncing(true);
    setBatchProgress('Preparing...');
    try {
      const isAdminOrOwner = userRole === 'ADMIN' || userRole === 'OWNER';
      // Fetch all pending/mapped scans for this location (all pages)
      const allPending: ScanRecord[] = [];
      let fetchPage = 1;
      let fetchMore = true;
      while (fetchMore) {
        if (fetchPage > 100) break;
        const { scans: pageScans, hasMore: more } = await api.getScans(jwt, locationId, fetchPage, 100);
        allPending.push(...(pageScans ?? []).filter((s) =>
          isAdminOrOwner
            ? (s.status === 'PENDING' || s.status === 'MAPPED')
            : s.status === 'APPROVED'
        ));
        fetchMore = more;
        fetchPage++;
      }

      const mappings = await api.getMappings(jwt, locationId);
      const templates = await api.getTemplates(jwt, locationId);
      const valueMappingsByTemplate = new Map<string, ValueMapping[]>();
      await Promise.all(
        templates.map(async (template) => {
          const valueMappings = await api.getValueMappings(jwt, template.id);
          valueMappingsByTemplate.set(template.id, valueMappings ?? []);
        }),
      );
      const journalEntryTemplate = templates.find((t) => t.transactionType === 'JOURNAL_ENTRY' && t.isActive);

      const billPaymentCount = allPending.filter((s) => (s.transactionType ?? 'JOURNAL_ENTRY') === 'BILL_PAYMENT').length;
      const syncableScans = allPending.filter((s) => (s.transactionType ?? 'JOURNAL_ENTRY') !== 'BILL_PAYMENT');

      if (billPaymentCount > 0) {
        showToast(`${billPaymentCount} Bill Payment scan(s) skipped — sync from the Bill Payment preview form`, 'info');
      }

      const skippedReasons: { type: string; reason: string; count: number }[] = [];
      const skippedWarnings: string[] = [];
      const items: BatchSyncItem[] = [];

      for (const scan of syncableScans) {
        const txnType = (scan.transactionType ?? 'JOURNAL_ENTRY').toUpperCase();
        const sharedScanEntry = scan.source && scan.source !== 'pos' && scan.rawScanEntry ? scan.rawScanEntry as ScanEntry : undefined;

        if (txnType === 'JOURNAL_ENTRY') {
          const payload = buildJEPayload({
            scanRecordId: scan.id,
            scanData: scan.rawData,
            mappings,
            accounts,
            txnDate: scan.scanDate.slice(0, 10),
            scanEntry: sharedScanEntry,
            valueMappings: journalEntryTemplate ? valueMappingsByTemplate.get(journalEntryTemplate.id) ?? [] : [],
          });

          if (payload.lines.length > 0) {
            if (!payload.balanced) {
              skippedWarnings.push(
                `Skipped unbalanced entry (Debits: $${payload.totalDebits.toFixed(2)}, Credits: $${payload.totalCredits.toFixed(2)}, Diff: $${payload.imbalanceAmount.toFixed(2)})`,
              );
            } else {
              items.push({ ...payload, transactionType: 'JOURNAL_ENTRY' });
            }
          } else {
            const reason = 'no mapped line items';
            const existing = skippedReasons.find((s) => s.type === txnType && s.reason === reason);
            if (existing) { existing.count++; } else { skippedReasons.push({ type: txnType, reason, count: 1 }); }
          }
          continue;
        }

        if (txnType === 'BILL' || txnType === 'VENDOR_CREDIT') {
          const template = templates.find((t) => t.transactionType === txnType && t.isActive);
          if (!template?.defaults || !template.defaults.vendorRef || !template.defaults.apAccountRef) {
            const reason = 'missing header defaults (set up in Mapping tab)';
            const existing = skippedReasons.find((s) => s.type === txnType && s.reason === reason);
            if (existing) { existing.count++; } else { skippedReasons.push({ type: txnType, reason, count: 1 }); }
            continue;
          }

          const payload = buildBillLikePayload({
            scanRecordId: scan.id,
            transactionType: txnType as 'BILL' | 'VENDOR_CREDIT',
            scanData: scan.rawData,
            mappings,
            accounts,
            vendors,
            terms,
            taxCodes,
            txnDate: scan.scanDate.slice(0, 10),
            defaults: template.defaults as Record<string, { value: string; name?: string } | null>,
            scanEntry: sharedScanEntry,
            valueMappings: valueMappingsByTemplate.get(template.id) ?? [],
          });

          if (payload) {
            items.push(payload);
          } else {
            const reason = 'no mapped line items';
            const existing = skippedReasons.find((s) => s.type === txnType && s.reason === reason);
            if (existing) { existing.count++; } else { skippedReasons.push({ type: txnType, reason, count: 1 }); }
          }
          continue;
        }

        if (txnType === 'CHEQUE') {
          const template = templates.find((t) => t.transactionType === 'CHEQUE' && t.isActive);
          if (!template?.defaults || !template.defaults.bankAccountRef || !template.defaults.payeeRef) {
            const reason = 'missing header defaults (set up in Mapping tab)';
            const existing = skippedReasons.find((s) => s.type === txnType && s.reason === reason);
            if (existing) { existing.count++; } else { skippedReasons.push({ type: txnType, reason, count: 1 }); }
            continue;
          }

          const payload = buildChequePayload({
            scanRecordId: scan.id,
            scanData: scan.rawData,
            mappings,
            accounts,
            customers,
            vendors,
            taxCodes,
            txnDate: scan.scanDate.slice(0, 10),
            defaults: template.defaults as Record<string, { value: string; name?: string } | null>,
            scanEntry: sharedScanEntry,
            valueMappings: valueMappingsByTemplate.get(template.id) ?? [],
          });

          if (payload) {
            items.push(payload);
          } else {
            const reason = 'no mapped line items';
            const existing = skippedReasons.find((s) => s.type === txnType && s.reason === reason);
            if (existing) { existing.count++; } else { skippedReasons.push({ type: txnType, reason, count: 1 }); }
          }
          continue;
        }
      }

      if (skippedWarnings.length > 0) {
        showToast(
          `[Batch Sync] Skipped ${skippedWarnings.length} unbalanced entries. Review them individually.`,
          'error',
        );
      }

      for (const skip of skippedReasons) {
        const label = TRANSACTION_TYPE_LABELS[skip.type as keyof typeof TRANSACTION_TYPE_LABELS] ?? skip.type;
        showToast(`${skip.count} ${label} scan(s) skipped — ${skip.reason}`, 'info');
      }

      if (items.length === 0) {
        if (skippedReasons.length === 0) {
          showToast('No pending scans to sync', 'info');
        }
        return;
      }

      setBatchProgress(`Syncing ${items.length} scan${items.length !== 1 ? 's' : ''}...`);

      const { results, summary } = await api.syncBatch(jwt, items);

      const hasAuthFailure = results.some((r) => r.status === 'FAILED' && r.errorType === 'AUTH');
      showToast(
        `${summary.synced} synced, ${summary.skipped} skipped, ${summary.failed} failed`,
        summary.failed > 0 ? 'error' : 'success',
      );
      if (hasAuthFailure) {
        showToast('QuickBooks connection expired. Please reconnect.', 'error');
      }

      await refreshScans();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Batch sync failed', 'error');
    } finally {
      setBatchSyncing(false);
      setBatchProgress('');
    }
  };

  const safeScans = scans ?? [];
  const filteredScans = safeScans.filter((s) => {
    if (sourceFilter !== 'all' && (s.source ?? 'pos').toLowerCase() !== sourceFilter) return false;
    if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
    return true;
  });
  const isSyncMode = mode === 'sync-history' || mode === undefined;
  const visibleStatusOptions = mode === 'review'
    ? STATUS_FILTER_OPTIONS.filter((opt) => ['PENDING_APPROVAL', 'REJECTED'].includes(opt.value))
    : mode === 'approved'
      ? STATUS_FILTER_OPTIONS.filter((opt) => ['APPROVED', 'REJECTED'].includes(opt.value))
      : STATUS_FILTER_OPTIONS.filter((opt) => ['PENDING', 'SYNCED', 'FAILED'].includes(opt.value));
  const isAllVisibleSelected = filteredScans.length > 0 && filteredScans.every((scan) => selectedScanIds.has(scan.id));
  const selectedCount = selectedScanIds.size;
  const toggleScanSelection = (scanId: string) => {
    const nextSelection = new Set(selectedScanIds);
    if (nextSelection.has(scanId)) {
      nextSelection.delete(scanId);
    } else {
      nextSelection.add(scanId);
    }
    setSelectedScanIds(nextSelection);
  };
  const toggleSelectAllVisible = () => {
    const nextSelection = new Set(selectedScanIds);
    if (isAllVisibleSelected) {
      filteredScans.forEach((scan) => nextSelection.delete(scan.id));
    } else {
      filteredScans.forEach((scan) => nextSelection.add(scan.id));
    }
    setSelectedScanIds(nextSelection);
  };
  const totalSynced = safeScans.filter((s) => s.status === 'SYNCED').length;
  const totalFailed = safeScans.filter((s) => s.status === 'FAILED').length;
  const totalApproved = safeScans.filter((s) => s.status === 'APPROVED').length;
  const totalRejected = safeScans.filter((s) => s.status === 'REJECTED').length;
  const totalPendingApproval = safeScans.filter((s) => s.status === 'PENDING_APPROVAL').length;
  const totalPending = safeScans.filter((s) => s.status === 'PENDING' || s.status === 'MAPPED').length;
  const staleCount = safeScans.filter((s) => getScanAttention(s) === 'stale').length;
  const maxRetriedCount = safeScans.filter((s) => getScanAttention(s) === 'max-retried').length;
  const oldFailureCount = safeScans.filter((s) => getScanAttention(s) === 'old-failure').length;
  const totalAttention = staleCount + maxRetriedCount + oldFailureCount;

  useEffect(() => {
    if (totalSynced > 0) {
      onHasSynced?.();
    }
  }, [totalSynced, onHasSynced]);

  return (
    <div className="p-3 space-y-3">
      {/* Stats */}
      {mode === 'review' ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white border border-blue-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-600">{totalPendingApproval}</div>
            <div className="text-xs text-blue-500 mt-0.5">For Review</div>
          </div>
          <div className="bg-white border border-red-300 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-600">{totalRejected}</div>
            <div className="text-xs text-gray-600 mt-0.5">Rejected</div>
          </div>
        </div>
      ) : mode === 'approved' ? (
        <div className="grid grid-cols-1 gap-2">
          <div className="bg-white border border-emerald-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-emerald-600">{totalApproved}</div>
            <div className="text-xs text-gray-600 mt-0.5">Approved</div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-900">{safeScans.length}</div>
            <div className="text-xs text-gray-600 mt-0.5">Total Scans</div>
          </div>
          <div className="bg-white border border-emerald-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-emerald-600">{totalSynced}</div>
            <div className="text-xs text-gray-600 mt-0.5">Synced to QB</div>
          </div>
          <div className="bg-white border border-red-300 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-600">{totalFailed}</div>
            <div className="text-xs text-gray-600 mt-0.5">Failed</div>
          </div>
          <div className="bg-white border border-amber-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-amber-600">{totalPending}</div>
            <div className="text-xs text-gray-600 mt-0.5">Pending</div>
          </div>
        </div>
      )}

      {/* Location picker */}
      {locations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {totalPending > 0 && (
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded flex-shrink-0">
                {totalPending} pending
              </span>
            )}
            {isSyncMode && status.connected && (userRole === 'ADMIN' || userRole === 'OWNER' || userRole === 'MANAGER') && (totalPending > 0 || batchSyncing) && (
              <button
                onClick={() => setShowSyncConfirm(true)}
                disabled={batchSyncing || isRetryingAll}
                className="text-xs bg-amber-700 hover:bg-amber-600 disabled:bg-amber-200 text-white px-3 py-1 rounded transition-colors flex-shrink-0"
              >
                {batchSyncing ? '⏳ Syncing...' : '⚡ Sync All Pending'}
              </button>
            )}
            {status.connected && totalFailed > 0 && (
              <button
                onClick={() => void handleRetryAllFailed()}
                disabled={batchSyncing || isRetryingAll}
                className="text-xs bg-amber-600 hover:bg-amber-700 disabled:bg-amber-200 text-white px-3 py-1 rounded transition-colors flex-shrink-0"
              >
                {isRetryingAll ? '⏳ Retrying...' : `↻ Retry ${totalFailed} Failed`}
              </button>
            )}
            {selectedScanIds.size > 0 && (userRole === 'ADMIN' || userRole === 'OWNER' || userRole === 'MANAGER') && (
              <>
                {status.connected && (
                  <button
                    onClick={() => void handleSyncSelected()}
                    disabled={batchSyncing}
                    className="text-xs bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-200 text-white px-3 py-1 rounded transition-colors flex-shrink-0"
                  >
                    {batchSyncing ? '⏳ Syncing...' : `Sync Selected (${selectedScanIds.size})`}
                  </button>
                )}
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={batchSyncing}
                  className="text-xs bg-red-600 hover:bg-red-700 disabled:bg-red-200 text-white px-3 py-1 rounded transition-colors flex-shrink-0"
                >
                  Delete Selected
                </button>
              </>
            )}
          </div>
          {batchSyncing && batchProgress && (
            <p className="text-xs text-amber-400 text-center animate-pulse">{batchProgress}</p>
          )}
          <ConfirmDialog
            open={showSyncConfirm}
            title="Sync to QuickBooks"
            message={`Sync ${totalPending} entries to QuickBooks? This will create journal entries in your QuickBooks account.`}
            confirmText="Sync All"
            onConfirm={() => { setShowSyncConfirm(false); void handleSyncAll(); }}
            onCancel={() => setShowSyncConfirm(false)}
          />
          <ConfirmDialog
            open={showDeleteConfirm}
            title="Delete Selected Scans"
            message={`Delete ${selectedScanIds.size} selected scan${selectedScanIds.size !== 1 ? 's' : ''}? This cannot be undone.`}
            confirmText="Delete"
            onConfirm={() => { setShowDeleteConfirm(false); void handleDeleteSelected(); }}
            onCancel={() => setShowDeleteConfirm(false)}
          />
        </div>
      )}

      {isSyncMode && totalAttention > 0 && (
        <div className="mb-3 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-xs">
          <span className="text-amber-600 font-medium">
            ⚠ {totalAttention} scan{totalAttention > 1 ? 's' : ''} need{totalAttention === 1 ? 's' : ''} attention
          </span>
          <span className="text-slate-400 ml-2">
            {staleCount > 0 && `${staleCount} stale`}
            {staleCount > 0 && maxRetriedCount > 0 && ' · '}
            {maxRetriedCount > 0 && `${maxRetriedCount} max-retried`}
            {maxRetriedCount > 0 && oldFailureCount > 0 && ' · '}
            {oldFailureCount > 0 && `${oldFailureCount} old failure${oldFailureCount > 1 ? 's' : ''}`}
          </span>
          {maxRetriedCount > 0 && (
            <span className="text-slate-500 ml-2">— Re-sync max-retried scans from Preview tab</span>
          )}
        </div>
      )}

      {/* History table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-200">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Sync History</span>
        </div>
        <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2">
          <span className="text-xs text-gray-600 flex-shrink-0">Filter:</span>
          <select
            className="bg-[#F5F5F7] border border-gray-200 text-gray-600 text-xs rounded px-2 py-1 focus:border-emerald-500 focus:outline-none"
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              setSelectedScanIds(new Set());
            }}
          >
            <option value="all">All Sources</option>
            <option value="pos">POS Only</option>
            <option value="excel">Excel Only</option>
            <option value="image">Image Only</option>
            <option value="pdf">PDF Only</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setSelectedScanIds(new Set());
            }}
            className="bg-[#F5F5F7] border border-gray-200 text-gray-600 text-xs rounded px-2 py-1 focus:border-emerald-500 focus:outline-none"
          >
            {visibleStatusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {(sourceFilter !== 'all' || statusFilter !== 'ALL') && (
            <span className="text-xs text-gray-600">
              {filteredScans.length} of {safeScans.length} scans
            </span>
          )}
        </div>

        {loading ? (
          <div className="py-8 text-center text-gray-600 text-sm">Loading…</div>
        ) : error ? (
          <div className="py-4 text-center text-red-600 text-xs px-3">{error}</div>
        ) : !locationId ? (
          <div className="py-8 text-center">
            <div className="text-2xl mb-2">📍</div>
            <p className="text-gray-600 text-sm">No location selected</p>
            <p className="text-gray-600 text-xs mt-1">Add a location in Settings first</p>
          </div>
        ) : filteredScans.length === 0 && safeScans.length > 0 ? (
          <div className="py-8 text-center">
            <div className="text-2xl mb-2">🔍</div>
            <p className="text-gray-600 text-sm">No scans match the selected filter</p>
            <p className="text-gray-600 text-xs mt-1">Try changing the source filter above</p>
          </div>
        ) : safeScans.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-2xl mb-2">📭</div>
            <p className="text-gray-600 text-sm">No scans yet</p>
            <p className="text-gray-600 text-xs mt-1">
              {onboardingStep === 4
                ? 'Begin your first sync — scan a report or invoice, map it, and push to QuickBooks'
                : 'Go to Scan tab and scan a Toast report to get started'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-200/30">
                  <th className="text-left px-3 py-2 text-gray-600 font-medium w-[32px]">
                    <input
                      type="checkbox"
                      className="form-checkbox h-4 w-4 text-emerald-600"
                      checked={isAllVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      aria-label="Select all visible scans"
                    />
                  </th>
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Scan Date</th>
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Status</th>
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">QB Document ID</th>
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Created</th>
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Source</th>
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Vendor</th>
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Invoice #</th>
                  <th className="text-right px-3 py-2 text-gray-600 font-medium">Total</th>
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredScans.map((scan) => {
                  const latestLog = scan.syncLogs?.slice().sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime())[0];
                  const attempts = latestLog?.attemptCount ?? 1;
                  const txnId = latestLog?.qbJournalEntryId;
                  const qbBaseUrl = status.environment === 'sandbox'
                    ? 'https://app.sandbox.qbo.intuit.com'
                    : 'https://app.qbo.intuit.com';
                  const qbPath = latestLog?.syncType === 'BILL' ? 'bill'
                    : latestLog?.syncType === 'CHEQUE' ? 'expense'
                    : latestLog?.syncType === 'VENDOR_CREDIT' ? 'vendorcredit'
                    : 'journal';
                  const retryDisabled = scan.syncLogs?.some((l) => l.attemptCount >= 3) ?? false;
                  const attention = getScanAttention(scan);
                  const scanSource = (scan.source ?? 'pos').toLowerCase();
                  return (
                    <React.Fragment key={scan.id}>
                      <tr className={`border-t border-gray-200/50 hover:bg-gray-100 ${attention === 'max-retried' ? 'bg-red-50' : attention === 'stale' || attention === 'old-failure' ? 'bg-amber-50' : ''}`}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="form-checkbox h-4 w-4 text-emerald-600"
                            checked={selectedScanIds.has(scan.id)}
                            onChange={() => toggleScanSelection(scan.id)}
                            aria-label={`Select scan ${scan.scanDate}`}
                          />
                        </td>
                        <td className="px-3 py-2 text-gray-700 font-mono">{scan.scanDate}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded border text-xs ${STATUS_CLASSES[scan.status] ?? 'text-gray-600'}`}>
                            {scan.status}
                            {scan.status === 'FAILED' ? ` (${attempts}/3)` : ''}
                            {attention === 'stale' && (
                              <span className="ml-1 text-amber-400" title="Scan data is over 24h old and hasn't been synced">⏰</span>
                            )}
                            {attention === 'max-retried' && (
                              <span className="ml-1 text-red-500" title="Maximum retries reached (3/3). Re-sync from Preview tab.">⛔</span>
                            )}
                            {attention === 'old-failure' && (
                              <span className="ml-1 text-amber-400" title="Failed over 24h ago. Retries available — use Retry button.">⚠️</span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-gray-600">
                          {txnId
                            ? <a href={`${qbBaseUrl}/app/${qbPath}?txnId=${txnId}`} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline" title="View in QuickBooks">{txnId} ↗</a>
                            : '—'
                          }
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {new Date(scan.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2">
                          {scanSource === 'excel' ? (
                            <span
                              className="px-2 py-0.5 rounded border text-xs bg-emerald-50 border-emerald-200 text-emerald-400 cursor-pointer hover:bg-emerald-100"
                              title="Excel import — click to inspect"
                              onClick={() => {
                                if (scan.rawScanEntry) {
                                  setExpandedScanId(expandedScanId === scan.id ? null : scan.id);
                                }
                              }}
                            >
                              Excel{expandedScanId === scan.id ? ' ▾' : ' ▸'}
                            </span>
                          ) : scanSource === 'image' ? (
                            <span
                              className="px-2 py-0.5 rounded border text-xs bg-emerald-50 border-emerald-200 text-emerald-400 cursor-pointer hover:bg-emerald-100"
                              title="Image scan — click to inspect"
                              onClick={() => {
                                if (scan.rawScanEntry) {
                                  setExpandedScanId(expandedScanId === scan.id ? null : scan.id);
                                }
                              }}
                            >
                              Image{expandedScanId === scan.id ? ' ▾' : ' ▸'}
                            </span>
                          ) : scanSource === 'pdf' ? (
                            <span
                              className="px-2 py-0.5 rounded border text-xs bg-orange-50 border-orange-200 text-orange-400 cursor-pointer hover:bg-orange-100"
                              title="PDF scan — click to inspect"
                              onClick={() => {
                                if (scan.rawScanEntry) {
                                  setExpandedScanId(expandedScanId === scan.id ? null : scan.id);
                                }
                              }}
                            >
                              PDF{expandedScanId === scan.id ? ' ▾' : ' ▸'}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded border text-xs bg-emerald-50 border-emerald-200 text-emerald-400" title="POS scan">
                              POS
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600 max-w-[120px] truncate" title={scan.rawScanEntry?.header?.vendor ?? ''}>
                          {scan.rawScanEntry?.header?.vendor || '—'}
                        </td>
                        <td className="px-3 py-2 text-gray-600 font-mono">
                          {scan.rawScanEntry?.header?.invoiceNumber || '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700 font-mono">
                          {scan.rawScanEntry?.header?.total
                            ? `$${scan.rawScanEntry.header.total}`
                            : '—'
                          }
                        </td>
                        <td className="px-3 py-2">
                          {scan.status === 'FAILED' && (
                            <button
                              onClick={() => void handleRetryScan(scan.id)}
                              disabled={isRetryingId === scan.id || retryDisabled}
                              title={retryDisabled ? 'Maximum retries reached (3 attempts)' : 'Retry sync'}
                              className="text-xs text-emerald-400 hover:text-emerald-600 border border-emerald-200 hover:border-emerald-200 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                            >
                              {isRetryingId === scan.id ? '⏳ Retrying...' : '↻ Retry'}
                            </button>
                          )}
                          {scan.status === 'PENDING_APPROVAL' && showApprovalActions &&
                            (userRole === 'ADMIN' || userRole === 'OWNER' || userRole === 'MANAGER') && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => void handleApprove(scan.id)}
                                disabled={approvingId === scan.id}
                                className="px-2 py-1 text-xs bg-emerald-500 text-white rounded hover:bg-emerald-600 disabled:opacity-50"
                              >
                                {approvingId === scan.id ? '...' : 'Approve'}
                              </button>
                              <button
                                onClick={() => void handleReject(scan.id)}
                                disabled={rejectingId === scan.id}
                                className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                              >
                                {rejectingId === scan.id ? '...' : 'Reject'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {expandedScanId === scan.id && scan.rawScanEntry && (
                        <tr className="border-t border-gray-200/30 bg-gray-100">
                          <td colSpan={10} className="px-4 py-3" onClick={() => setExpandedScanId(null)}>
                            {(() => {
                              const entry = scan.rawScanEntry as ScanEntry;
                              const header = entry.header ?? {};
                              const headerKeys = Object.keys(header);
                              return (
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                                    {entry.fileName && (
                                      <span className="bg-white border border-gray-200 rounded px-2 py-0.5">
                                        📄 {entry.fileName}
                                      </span>
                                    )}
                                    {entry.rowNumber != null && (
                                      <span className="bg-white border border-gray-200 rounded px-2 py-0.5">
                                        Row {entry.rowNumber}
                                      </span>
                                    )}
                                    {entry.source && (
                                      <span className="bg-white border border-gray-200 rounded px-2 py-0.5">
                                        Source: {entry.source}
                                      </span>
                                    )}
                                  </div>
                                  {headerKeys.length > 0 && (
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                      {headerKeys.map((key) => (
                                        <div key={key} className="text-xs">
                                          <span className="text-gray-600">{key}:</span>{' '}
                                          <span className="text-gray-600">{header[key]}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {entry.lineItems && entry.lineItems.length > 0 && (
                                    <div className="mt-1 text-xs text-gray-600">
                                      {entry.lineItems.length} line item{entry.lineItems.length !== 1 ? 's' : ''}
                                    </div>
                                  )}
                                  {scan.status === 'REJECTED' && scan.approvalNotes && (
                                    <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                                      <div className="text-xs font-semibold text-red-700 mb-1">Rejection Reason:</div>
                                      <div className="text-sm text-red-600">{scan.approvalNotes}</div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      )}
                      {scan.status === 'FAILED' && latestLog && (latestLog.errorMessage || latestLog.errorType) && (
                        <tr>
                          <td colSpan={10} className="px-3 pb-2 pt-0">
                            {latestLog.errorType === 'AUTH' ? (
                              <div className="text-xs text-red-600 bg-red-50 border border-red-300 rounded px-2 py-1.5 space-y-1">
                                <div>QuickBooks connection expired. Please reconnect.</div>
                                <button
                                  onClick={() => {
                                    api.getQBAuthUrl(jwt)
                                      .then(({ authUrl }) => chrome.tabs.create({ url: authUrl }))
                                      .catch(() => showToast('Failed to start QuickBooks reconnection', 'error'));
                                  }}
                                  className="text-xs text-orange-400 hover:text-orange-600 border border-orange-200 hover:border-orange-600 px-2 py-0.5 rounded transition-colors"
                                >
                                  ↻ Reconnect QuickBooks
                                </button>
                              </div>
                            ) : latestLog.errorType === 'TRANSIENT' ? (
                              <div className="text-xs text-amber-400 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                ⚠ Sync failed due to a temporary issue. Please try again.
                              </div>
                            ) : latestLog.errorType === 'VALIDATION' ? (
                              <div className="text-xs text-gray-700 bg-gray-100 border border-gray-200 rounded px-2 py-1">
                                Sync failed: {latestLog.errorMessage}
                              </div>
                            ) : latestLog.errorType === 'FATAL' ? (
                              <div className="text-xs text-red-600 bg-red-50 border border-red-300 rounded px-2 py-1">
                                Sync failed. Please try again or contact support.
                              </div>
                            ) : (
                              <div className="text-xs text-red-600 bg-red-50 border border-red-300 rounded px-2 py-1">
                                {latestLog.errorMessage}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info */}
      <p className="text-xs text-gray-700 text-center">
        Sync bills and journal entries from the Preview tab (⚡ Sync to QuickBooks)
      </p>

      {/* Load more */}
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading || batchSyncing}
          className="w-full py-2 text-xs text-gray-600 hover:text-gray-700 border border-dashed border-gray-200 hover:border-gray-500 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
