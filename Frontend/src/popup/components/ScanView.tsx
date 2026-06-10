import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ScanData, ScanEntry, ScanMode, Template, ExcelDataParseResult, ExcelParseResult, TabId } from '../../types';
import { api } from '../lib/api';
import { extractTextFromImage, extractTextFromPDF } from '../lib/tesseract';
import { parseInvoiceText } from '../lib/invoice-parser';
import { ErrorCard, EmptyState } from './shared';

const POS_URLS: Record<string, { pattern: RegExp; name: string }> = {
  toast: { pattern: /toasttab\.com/, name: 'Toast' },
  salido: { pattern: /salido\.com/, name: 'SALIDO' },
  oracle: { pattern: /oraclerestaurants\.com/, name: 'Oracle' },
};

async function findPOSTab(): Promise<{ tab: chrome.tabs.Tab; posType: string; posName: string } | null> {
  const allTabs = await chrome.tabs.query({});
  for (const [posType, { pattern, name }] of Object.entries(POS_URLS)) {
    const tab = allTabs.find((t) => t.url && pattern.test(t.url));
    if (tab) return { tab, posType, posName: name };
  }
  return null;
}

const generateId = () => Math.random().toString(36).substring(2, 11);

const parseNumericValue = (value: string): number => {
  const cleaned = String(value).replace(/[^0-9.-]/g, '').trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

interface Props {
  jwt: string;
  scanData: ScanData | null;
  onScanData: (data: ScanData) => void;
  onClearScanData: () => void;
  onScanRecordId?: (id: string) => void;
  locationId: string | null;
  onboardingStep?: number;
  selectedTemplate?: Template | null;
  onOpenExcelImportModal?: () => void;
  onTabChange: (tab: TabId) => void;
  scanEntries: ScanEntry[];
  setScanEntries: React.Dispatch<React.SetStateAction<ScanEntry[]>>;
  activeScanEntryId: string | null;
  setActiveScanEntryId: React.Dispatch<React.SetStateAction<string | null>>;
  activeScanEntry: ScanEntry | null;
}

export default function ScanView({
  jwt,
  scanData,
  onScanData,
  onClearScanData,
  onScanRecordId,
  locationId,
  onboardingStep = 0,
  selectedTemplate,
  onOpenExcelImportModal,
  onTabChange,
  scanEntries,
  setScanEntries,
  activeScanEntryId,
  setActiveScanEntryId,
  activeScanEntry,
}: Props) {
  // MIGRATION PLAN: preserve the current POS scan contract while moving toward ScanEntry-driven ingestion.
  // - Existing POS scan data remains available as `scanData: Record<string, number>` for MappingView compatibility.
  // - New ScanEntry records are stored locally in ScanView for both POS and Excel scan modes.
  // - activeScanEntry.lineItems[0] is converted into numeric `scanData` for legacy mapping bindings.
  const [scanMode, setScanMode] = useState<ScanMode>('pos');
  const [uploadedExcelFile, setUploadedExcelFile] = useState<File | null>(null);
  const [excelPreviewSheets, setExcelPreviewSheets] = useState<ExcelParseResult['sheets']>([]);
  const [excelPreviewSheetName, setExcelPreviewSheetName] = useState<string>('');
  const [excelParseError, setExcelParseError] = useState<string | null>(null);
  const [excelPreviewLoading, setExcelPreviewLoading] = useState(false);
  const [excelParseLoading, setExcelParseLoading] = useState(false);
  const [excelDataResult, setExcelDataResult] = useState<ExcelDataParseResult | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState<string | null>(null);
  const [invoiceUploading, setInvoiceUploading] = useState(false);
  const [invoiceUploadError, setInvoiceUploadError] = useState<string | null>(null);
  const [invoiceScanComplete, setInvoiceScanComplete] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedPOS, setDetectedPOS] = useState<{ type: string; name: string } | null>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const invoiceFileInputRef = useRef<HTMLInputElement>(null);

  // Load cached scan data and detect POS tab on mount
  useEffect(() => {
    chrome.storage.local.get(['lastScanData'], (result) => {
      const cached = result['lastScanData'] as ScanData | undefined;
      if (cached) {
        if ('Food Sales' in cached || 'Beverage Sales' in cached) {
          chrome.storage.local.remove(['lastScanData']);
          console.log('[Nest] Cleared stale cached scan data (old mock format)');
          return;
        }
        if (!scanData) onScanData(cached);
      }
    });
    findPOSTab().then((result) => {
      if (result) setDetectedPOS({ type: result.posType, name: result.posName });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!scanData || scanMode !== 'pos' || scanEntries.length > 0) return;
    const entry: ScanEntry = {
      id: generateId(),
      source: 'pos',
      header: {},
      lineItems: [Object.fromEntries(Object.entries(scanData).map(([key, value]) => [key, String(value)]))],
    };
    setScanEntries([entry]);
    setActiveScanEntryId(entry.id);
  }, [scanData, scanMode, scanEntries.length]);

  useEffect(() => {
    if (invoicePreviewUrl) {
      return () => {
        URL.revokeObjectURL(invoicePreviewUrl);
      };
    }
    return undefined;
  }, [invoicePreviewUrl]);

  useEffect(() => {
    setInvoiceFile(null);
    setInvoicePreviewUrl(null);
    setInvoiceUploadError(null);
    setInvoiceScanComplete(false);
    if (invoiceFileInputRef.current) {
      invoiceFileInputRef.current.value = '';
    }
  }, [scanMode]);

  const activeScanData = useMemo(() => {
    if (!activeScanEntry?.lineItems?.[0]) return null;
    return Object.fromEntries(
      Object.entries(activeScanEntry.lineItems[0]).map(([key, rawValue]) => [key, parseNumericValue(rawValue)]),
    ) as ScanData;
  }, [activeScanEntry]);

  useEffect(() => {
    if (activeScanData) {
      onScanData(activeScanData);
    } else {
      onClearScanData();
    }
  }, [activeScanData, onScanData, onClearScanData]);

  /** Send REQUEST_SCAN to a tab and return the response (or null on failure). */
  const sendScanMessage = (tabId: number): Promise<{ data?: ScanData } | null> => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[Nest Popup] Scan timed out for tab', tabId);
        resolve(null);
      }, 30000);

      chrome.tabs.sendMessage(tabId, { type: 'REQUEST_SCAN' }, (resp) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          console.warn('[Nest Popup] sendMessage error:', chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(resp);
        }
      });
    });
  };

  const handleClear = () => {
    onClearScanData();
    chrome.storage.local.remove(['lastScanData']);
    setScanEntries([]);
    setActiveScanEntryId(null);
    setUploadedExcelFile(null);
    setExcelPreviewSheets([]);
    setExcelPreviewSheetName('');
    setExcelDataResult(null);
    setExcelParseError(null);
    setInvoiceFile(null);
    setInvoicePreviewUrl(null);
    setInvoiceUploading(false);
    setInvoiceUploadError(null);
    setInvoiceScanComplete(false);
    if (invoiceFileInputRef.current) {
      invoiceFileInputRef.current.value = '';
    }
  };

  const handleRescan = async () => {
    setScanning(true);
    setError(null);
    try {
      // Find any open POS tab across ALL windows
      const posResult = await findPOSTab();
      const tab = posResult?.tab;
      const posType = posResult?.posType ?? 'toast';
      const posName = posResult?.posName ?? 'POS';
      console.log(`[Nest Popup] Scan triggered — found ${posName} tab:`, tab?.id, 'url:', tab?.url);
      if (!tab?.id) throw new Error('No POS report tab found — open a supported POS report page');

      // Try sending the scan message
      let response = await sendScanMessage(tab.id);

      // If content script isn't injected yet, inject it and retry
      if (!response) {
        const scriptFile = posType === 'salido'
          ? 'content/salido-scanner.js'
          : posType === 'oracle'
            ? 'content/oracle-scanner.js'
            : 'content/scanner.js';
        console.log('[Nest Popup] Content script not responding — injecting scanner into tab', tab.id);
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [scriptFile],
          });
          await new Promise((r) => setTimeout(r, 1500));
          console.log('[Nest Popup] Scanner injected — retrying scan...');
          response = await sendScanMessage(tab.id);
        } catch (injectErr) {
          console.error('[Nest Popup] Failed to inject content script:', injectErr);
          throw new Error('Could not inject scanner into tab — try refreshing the page');
        }
      }

      console.log('[Nest Popup] Response from content script:', response,
        response?.data ? `| keys: ${Object.keys(response.data).length}` : '| no data');
      if (response?.data) {
        const entry: ScanEntry = {
          id: generateId(),
          source: 'pos',
          header: {},
          lineItems: [Object.fromEntries(Object.entries(response.data).map(([key, value]) => [key, String(value)]))],
        };
        setScanEntries([entry]);
        setActiveScanEntryId(entry.id);
        onScanData(response.data);
        chrome.storage.local.set({ lastScanData: response.data });
        if (locationId) {
          try {
            const scanRecord = await api.saveScan(
              jwt,
              locationId,
              new Date().toISOString().split('T')[0],
              response.data,
            );
            console.log('[Nest] Scan data saved to backend');
            if (scanRecord?.id && onScanRecordId) {
              onScanRecordId(scanRecord.id);
            }
          } catch (saveErr) {
            console.error('[Nest] Failed to save scan to backend:', saveErr);
            // Don't block the UI — scan still worked locally
          }
        }
      } else {
        throw new Error('No data returned from scanner — try refreshing the page');
      }
    } catch (err) {
      console.error('[Nest Popup] Scan error:', err);
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleExcelFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !jwt) return;
    e.target.value = '';
    setUploadedExcelFile(file);
    setExcelParseError(null);
    setExcelPreviewSheets([]);
    setExcelPreviewSheetName('');
    setExcelDataResult(null);
    setExcelPreviewLoading(true);

    try {
      const result = await api.parseExcel(jwt, file);
      setExcelPreviewSheetName(result.selectedSheetName || result.sheets?.[0]?.name || '');
      setExcelPreviewSheets(result.sheets || []);
    } catch (err) {
      setExcelParseError(err instanceof Error ? err.message : 'Failed to parse Excel preview');
    } finally {
      setExcelPreviewLoading(false);
    }
  };

  const handleInvoiceFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (invoicePreviewUrl) {
      URL.revokeObjectURL(invoicePreviewUrl);
      setInvoicePreviewUrl(null);
    }
    setInvoiceFile(file);
    setInvoiceUploadError(null);
    setInvoiceScanComplete(false);

    if (file && scanMode === 'image') {
      setInvoicePreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleParseInvoice = async () => {
    if (!invoiceFile || !jwt || !locationId) return;
    setInvoiceUploading(true);
    setInvoiceUploadError(null);
    setInvoiceScanComplete(false);

    try {
      const source = invoiceFile.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image';
      const rawText = source === 'pdf'
        ? await extractTextFromPDF(invoiceFile)
        : await extractTextFromImage(invoiceFile);

      console.log('[OCR] Raw text (first 500 chars):', rawText.substring(0, 500));
      const parsed = parseInvoiceText(rawText);
      console.log('[OCR] Parsed result:', JSON.stringify(parsed, null, 2));

      const scanEntry: ScanEntry = {
        id: crypto.randomUUID(),
        source: source as ScanMode,
        fileName: invoiceFile.name,
        header: parsed.header,
        lineItems: parsed.lineItems,
      };

      setScanEntries([scanEntry]);
      setActiveScanEntryId(scanEntry.id);
      setInvoiceScanComplete(true);

      const scanDate = new Date().toISOString().split('T')[0];
      await api.saveScanEntry(jwt, locationId, scanDate, scanEntry, scanEntry.source);
    } catch (err) {
      setInvoiceUploadError(err instanceof Error ? err.message : 'OCR failed. Please try again or upload a clearer image.');
    } finally {
      setInvoiceUploading(false);
    }
  };

  const handleParseExcelData = async () => {
    if (!uploadedExcelFile || !jwt || !selectedTemplate) return;
    setExcelParseLoading(true);
    setExcelParseError(null);

    try {
      const result = await api.parseExcelData(jwt, selectedTemplate.id, uploadedExcelFile);
      setExcelDataResult(result);
      const parsedEntries: ScanEntry[] = result.transactions.flatMap((transaction) => {
        const txnType = selectedTemplate?.transactionType ?? 'JOURNAL_ENTRY';

        if (txnType === 'BILL' || txnType === 'VENDOR_CREDIT') {
          return [{
            id: generateId(),
            source: 'excel',
            fileName: uploadedExcelFile.name,
            rowNumber: 1,
            header: transaction.header,
            lineItems: transaction.lineItems,
          }];
        }

        return transaction.lineItems.map((lineItem, rowIndex) => ({
          id: generateId(),
          source: 'excel',
          fileName: uploadedExcelFile.name,
          rowNumber: rowIndex + 1,
          header: transaction.header,
          lineItems: [lineItem],
        }));
      });
      setScanEntries(parsedEntries);
      setActiveScanEntryId(parsedEntries[0]?.id ?? null);

      // Sequential batch save — one at a time, track partial failures
      if (locationId) {
        let savedCount = 0;
        let failCount = 0;
        for (const entry of parsedEntries) {
          try {
            await api.saveScanEntry(
              jwt,
              locationId,
              new Date().toISOString().split('T')[0],
              entry,
              'excel',
            );
            savedCount++;
          } catch (saveErr) {
            console.error(`[Nest] Failed to save Excel entry ${entry.id} (row ${entry.rowNumber ?? '?'}) :`, saveErr);
            failCount++;
          }
        }
        if (failCount > 0) {
          setExcelParseError(`Saved ${savedCount}/${parsedEntries.length} entries. ${failCount} failed to save to backend.`);
        } else {
          console.log(`[Nest] Excel batch save complete: ${savedCount}/${parsedEntries.length} saved.`);
        }
      }
    } catch (err) {
      setExcelParseError(err instanceof Error ? err.message : 'Failed to parse Excel data');
    } finally {
      setExcelParseLoading(false);
    }
  };

  const handleOpenExcelModal = () => {
    onOpenExcelImportModal?.();
    onTabChange('mappings');
  };

  const activeScanEntryLabel = activeScanEntry?.fileName
    ? `${activeScanEntry.fileName} (row ${activeScanEntry.rowNumber ?? 1})`
    : 'Active scan entry';

  return (
    <div className="p-3 space-y-4">
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={() => setScanMode('pos')}
          className={`text-xs rounded px-3 py-1.5 transition ${scanMode === 'pos' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
        >
          POS Scan
        </button>
        <button
          type="button"
          onClick={() => setScanMode('excel')}
          className={`text-xs rounded px-3 py-1.5 transition ${scanMode === 'excel' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
        >
          Excel Scan
        </button>
        <button
          type="button"
          onClick={() => setScanMode('image')}
          className={`text-xs rounded px-3 py-1.5 transition ${scanMode === 'image' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
        >
          📷 Image
        </button>
        <button
          type="button"
          onClick={() => setScanMode('pdf')}
          className={`text-xs rounded px-3 py-1.5 transition ${scanMode === 'pdf' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
        >
          📄 PDF
        </button>
      </div>

      {scanMode === 'excel' ? (
        <div className="space-y-4">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">Excel Scan</div>
                <div className="text-xs text-gray-400">Upload an Excel file and parse it into the scan pipeline.</div>
              </div>
              <button
                type="button"
                onClick={() => excelInputRef.current?.click()}
                className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded px-3 py-1.5"
              >
                Choose file
              </button>
            </div>
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls"
              aria-label="Upload Excel file"
              className="hidden"
              onChange={handleExcelFileSelect}
            />
            {uploadedExcelFile ? (
              <div className="text-xs text-gray-300">Selected file: {uploadedExcelFile.name}</div>
            ) : (
              <div className="text-xs text-gray-500">No Excel file selected yet.</div>
            )}
            {excelParseError && (
              <div className="text-xs text-red-400">{excelParseError}</div>
            )}
            {!selectedTemplate ? (
              <div className="rounded-lg border border-orange-700 bg-orange-950/20 p-3 text-xs text-orange-200">
                Select a template in the Mappings tab before parsing Excel data.
              </div>
            ) : !selectedTemplate.columnMappings || Object.keys(selectedTemplate.columnMappings).length === 0 ? (
              <div className="rounded-lg border border-orange-700 bg-orange-950/20 p-3 text-xs text-orange-200 space-y-2">
                <div>⚠️ This template has no column mapping configured. Configure it first.</div>
                <button
                  type="button"
                  onClick={handleOpenExcelModal}
                  className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 rounded px-3 py-1.5"
                >
                  Open Excel import modal
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-green-700 bg-green-950/20 p-3 text-xs text-green-200">
                ✅ Column mapping is configured for {selectedTemplate.name}.
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!uploadedExcelFile || !selectedTemplate || !selectedTemplate.columnMappings || Object.keys(selectedTemplate.columnMappings).length === 0 || excelParseLoading}
                onClick={handleParseExcelData}
                className="text-xs bg-cyan-700 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-40 text-white rounded px-3 py-1.5"
              >
                {excelParseLoading ? 'Parsing…' : 'Parse Excel Data'}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded px-3 py-1.5"
              >
                Clear scan
              </button>
            </div>
          </div>

          {excelPreviewSheets.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-gray-400">Preview from {excelPreviewSheetName || 'sheet'}</div>
                {excelPreviewSheets.length > 1 && (
                  <select
                    value={excelPreviewSheetName}
                    onChange={(e) => setExcelPreviewSheetName(e.target.value)}
                    title="Choose worksheet"
                    className="text-xs bg-gray-900 border border-gray-700 text-white rounded px-2 py-1"
                  >
                    {excelPreviewSheets.map((sheet) => (
                      <option key={sheet.name} value={sheet.name}>{sheet.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="text-xs text-gray-400">
                {excelPreviewLoading ? 'Loading preview…' : 'This preview shows the first parsed transaction row from Excel.'}
              </div>
              {(() => {
                const previewSheet = excelPreviewSheets.find((sheet) => sheet.name === excelPreviewSheetName) ?? excelPreviewSheets[0];
                if (!previewSheet) return null;
                return (
                  <div className="overflow-x-auto border border-gray-700 rounded-lg bg-gray-950">
                    <table className="min-w-full text-left text-xs text-gray-200">
                      <thead>
                        <tr className="border-b border-gray-700 bg-gray-900 text-gray-300">
                          {previewSheet.headers.map((header) => (
                            <th key={header} className="px-2 py-2">{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewSheet.rows.map((row, rowIndex) => (
                          <tr key={rowIndex} className="odd:bg-gray-950 even:bg-gray-900">
                            {previewSheet.headers.map((header) => (
                              <td key={header} className="px-2 py-2 text-gray-300 truncate max-w-[10rem]">{row[header]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}

          {excelDataResult && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-xs text-gray-200 space-y-2">
              <div>Parsed {excelDataResult.totalRows} row(s), skipped {excelDataResult.skippedRows} empty row(s).</div>
              <div>{excelDataResult.transactions.length} transaction(s) loaded into the scan pipeline.</div>
              <div>Active scan entry: {activeScanEntryLabel}</div>
            </div>
          )}
          {scanEntries.length > 1 && scanMode === 'excel' && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
              <div className="text-sm font-semibold text-white">Excel entries</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {scanEntries.map((entry, index) => {
                  const label = entry.fileName
                    ? `${entry.fileName} (row ${entry.rowNumber ?? index + 1})`
                    : `Entry ${index + 1}`;
                  const selected = entry.id === activeScanEntryId;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setActiveScanEntryId(entry.id)}
                      className={`text-left text-xs rounded-lg px-3 py-2 transition ${selected ? 'bg-cyan-700 text-white' : 'bg-gray-900 text-gray-300 hover:bg-gray-800'}`}
                    >
                      <div className="font-medium">{label}</div>
                      <div className="text-gray-400">{selected ? 'Active' : 'Select this entry'}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : scanMode === 'image' || scanMode === 'pdf' ? (
        <div className="space-y-4">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">
                  {scanMode === 'pdf' ? 'PDF Invoice Scan' : 'Image Invoice Scan'}
                </div>
                <div className="text-xs text-gray-400">
                  Upload a {scanMode === 'pdf' ? 'PDF invoice' : 'receipt image'} to continue.
                </div>
              </div>
              <button
                type="button"
                onClick={() => invoiceFileInputRef.current?.click()}
                className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded px-3 py-1.5"
              >
                Choose file
              </button>
            </div>
            <input
              ref={invoiceFileInputRef}
              type="file"
              accept={scanMode === 'pdf' ? '.pdf' : 'image/*'}
              className="hidden"
              onChange={handleInvoiceFileSelect}
            />
            {invoiceFile ? (
              <div className="space-y-2 text-xs text-gray-300">
                <div>Selected: {invoiceFile.name}</div>
                {scanMode === 'image' && invoicePreviewUrl && (
                  <img
                    src={invoicePreviewUrl}
                    alt="Selected invoice preview"
                    className="max-h-32 rounded border border-gray-700 object-contain"
                  />
                )}
              </div>
            ) : (
              <div className="text-xs text-gray-500">No file selected yet.</div>
            )}
            {invoiceUploadError && (
              <div className="rounded-md border border-red-700 bg-red-950/20 px-3 py-2 text-xs text-red-300 flex items-center justify-between gap-3">
                <span>{invoiceUploadError}</span>
                <button
                  type="button"
                  onClick={() => setInvoiceUploadError(null)}
                  className="text-xs text-red-200 hover:text-red-100"
                >
                  Dismiss
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!invoiceFile || invoiceUploading}
                onClick={handleParseInvoice}
                className="text-xs bg-cyan-700 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-40 text-white rounded px-3 py-1.5"
              >
                {invoiceUploading ? 'Uploading…' : 'Parse Invoice'}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded px-3 py-1.5"
              >
                Clear scan
              </button>
            </div>
            {invoiceScanComplete && scanEntries[0] && (
              <div className="rounded-lg border border-green-700 bg-green-950/20 p-3 text-xs text-green-200 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-green-400">✓</span>
                  <span className="font-medium text-green-100">Invoice parsed successfully</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-green-300/80">
                  {scanEntries[0].header?.vendor && (
                    <div>Vendor: <span className="text-green-100">{scanEntries[0].header.vendor}</span></div>
                  )}
                  {scanEntries[0].header?.invoiceNumber && (
                    <div>Invoice #: <span className="text-green-100">{scanEntries[0].header.invoiceNumber}</span></div>
                  )}
                  {scanEntries[0].header?.total && (
                    <div>Total: <span className="text-green-100">${scanEntries[0].header.total}</span></div>
                  )}
                  {scanEntries[0].lineItems && (
                    <div>Line items: <span className="text-green-100">{scanEntries[0].lineItems.length}</span></div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <div className={`text-xs px-2 py-1 rounded-full ${
              detectedPOS ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'
            }`}>
              {detectedPOS ? `🟢 ${detectedPOS.name} report page detected` : '⚪ No POS tab found'}
            </div>
            <button
              onClick={handleRescan}
              disabled={scanning}
              className="text-xs bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white px-3 py-1 rounded-lg transition-colors"
            >
              {scanning ? 'Scanning…' : '↻ Re-scan Page'}
            </button>
          </div>

          {error && (
            <ErrorCard message={error} onRetry={handleRescan} onDismiss={() => setError(null)} />
          )}

          {scanData ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500">Extracted {detectedPOS?.name ?? 'POS'} fields ({Object.keys(scanData).length})</span>
                <button
                  onClick={handleClear}
                  className="text-xs text-gray-400 hover:text-red-400 border border-gray-600 hover:border-red-700 px-2 py-0.5 rounded transition-colors"
                >
                  ✕ Clear
                </button>
              </div>
              <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left text-xs text-gray-500 px-3 py-2">Field</th>
                      <th className="text-right text-xs text-gray-500 px-3 py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(scanData).map(([field, value]) => (
                      <tr key={field} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                        <td className="px-3 py-2 text-gray-300 text-xs">{field}</td>
                        <td className="px-3 py-2 text-white text-xs text-right font-mono">
                          {field.includes('Count')
                            ? String(value)
                            : `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-700/40">
                      <td className="px-3 py-2 text-xs text-gray-400 font-medium">Total</td>
                      <td className="px-3 py-2 text-xs text-cyan-400 text-right font-mono font-bold">
                        ${Object.entries(scanData)
                          .filter(([key]) => !key.includes('Count'))
                          .reduce((sum, [, v]) => sum + v, 0)
                          .toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          ) : (
            <EmptyState
              icon="🍽️"
              title="No scan data yet"
              description={onboardingStep === 4
                ? 'Navigate to a POS report page, then click Re-scan Page to start your first sync pipeline'
                : 'Navigate to a POS report page, then click Re-scan Page.'}
              action={{ label: 'Re-scan Page', onClick: handleRescan }}
            />
          )}
        </>
      )}
    </div>
  );
}
