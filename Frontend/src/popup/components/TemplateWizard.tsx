import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toast';
import type { ScanMode, Template } from '../../types';
import { TRANSACTION_TYPE_LABELS } from '../../types';

interface TemplateWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onTemplateCreated: (template: Template) => void;
  jwt: string;
  locationId: string;
}

const SCAN_MODE_CARDS: Array<{
  value: ScanMode;
  icon: string;
  title: string;
  description: string;
}> = [
  {
    value: 'IMAGE',
    icon: '📄',
    title: 'Image / PDF',
    description: 'Scan invoices, receipts, or documents',
  },
  {
    value: 'EXCEL',
    icon: '📊',
    title: 'Excel / CSV',
    description: 'Import from spreadsheet files',
  },
  {
    value: 'POS',
    icon: '🏪',
    title: 'POS System',
    description: 'Toast, Oracle, or SALIDO',
  },
];

const TRANSACTION_TYPE_DESCRIPTIONS: Record<string, string> = {
  JOURNAL_ENTRY: 'Record debits and credits',
  BILL: 'Record a vendor bill',
  VENDOR_CREDIT: 'Record a vendor credit or refund',
  CHEQUE: 'Record a payment by check',
};

const TRANSACTION_TYPE_OPTIONS = ['JOURNAL_ENTRY', 'BILL', 'VENDOR_CREDIT', 'CHEQUE'] as const;

type TransactionType = (typeof TRANSACTION_TYPE_OPTIONS)[number];

const POS_SYSTEM_OPTIONS = [
  { value: 'generic', label: 'Any POS (AI)' },
  { value: 'toast', label: 'Toast' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'salido', label: 'SALIDO' },
];

const TRANSACTION_TYPE_SCAN_MODE_CONFIG: Record<string, { available: ScanMode[]; defaults: ScanMode[] }> = {
  JOURNAL_ENTRY: { available: ['POS', 'EXCEL', 'IMAGE'], defaults: ['POS'] },
  BILL:          { available: ['IMAGE', 'EXCEL'],        defaults: ['IMAGE'] },
  VENDOR_CREDIT: { available: ['IMAGE', 'EXCEL'],        defaults: ['IMAGE'] },
  CHEQUE:        { available: ['IMAGE', 'EXCEL'],        defaults: ['IMAGE'] },
};

export default function TemplateWizard({
  isOpen,
  onClose,
  onTemplateCreated,
  jwt,
  locationId,
}: TemplateWizardProps) {
  const { showToast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [scanModes, setScanModes] = useState<ScanMode[]>([]);
  const [posSystem, setPosSystem] = useState('');
  const [transactionType, setTransactionType] = useState<TransactionType | ''>('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setName('');
      setScanModes([]);
      setPosSystem('');
      setTransactionType('');
      setIsCreating(false);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (step === 2 && transactionType) {
      const config = TRANSACTION_TYPE_SCAN_MODE_CONFIG[transactionType];
      if (config) {
        setScanModes(config.defaults);
        if (!config.defaults.includes('POS')) {
          setPosSystem('');
        }
      }
    }
  }, [step, transactionType]);

  const canContinue = useMemo(() => {
    return Boolean(name.trim() && transactionType);
  }, [name, transactionType]);

  const canCreate = useMemo(() => {
    if (scanModes.length === 0) return false;
    if (scanModes.includes('POS') && !posSystem) return false;
    return true;
  }, [scanModes, posSystem]);

  const handleClose = () => {
    setStep(1);
    setName('');
    setScanModes([]);
    setPosSystem('');
    setTransactionType('');
    setIsCreating(false);
    setError(null);
    onClose();
  };

  const handleCreateTemplate = async () => {
    if (!canCreate || scanModes.length === 0 || !name.trim()) return;
    setIsCreating(true);
    setError(null);

    try {
      const data: {
        name: string;
        transactionType: string;
        scanModes: ScanMode[];
        posSystem?: string;
      } = {
        name: name.trim(),
        transactionType,
        scanModes,
      };

      if (scanModes.includes('POS')) {
        data.posSystem = posSystem;
      }

      const created = await api.createTemplate(jwt, locationId, data);
      onTemplateCreated(created);
      setStep(1);
      setName('');
      setScanModes([]);
      setPosSystem('');
      setTransactionType('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create template');
      showToast(err instanceof Error ? err.message : 'Failed to create template', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white border border-gray-200 rounded-lg p-4 w-full max-w-3xl space-y-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {step === 1 ? 'Step 1 of 2 — Transaction Type' : 'Step 2 of 2 — Scan Mode'}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-gray-600 hover:text-gray-900 text-sm"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">Template Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="w-full bg-[#F5F5F7] border border-gray-200 text-gray-900 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
              />
          </div>

          {step === 1 ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {TRANSACTION_TYPE_OPTIONS.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTransactionType(type)}
                    className={`text-left rounded-lg border p-4 transition-colors focus:outline-none ${
                      transactionType === type
                        ? 'border-emerald-500 ring-2 ring-emerald-200'
                        : 'border-gray-200 hover:border-gray-500'
                    }`}
                  >
                    <div className="font-semibold text-gray-900 mb-1">{TRANSACTION_TYPE_LABELS[type]}</div>
                    <div className="text-xs text-gray-600">{TRANSACTION_TYPE_DESCRIPTIONS[type]}</div>
                  </button>
                ))}
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="text-xs bg-gray-200 hover:bg-gray-100 text-gray-700 rounded px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={!canContinue}
                  className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 text-white rounded px-3 py-1.5"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {SCAN_MODE_CARDS.filter((card) => {
                  const config = TRANSACTION_TYPE_SCAN_MODE_CONFIG[transactionType];
                  return config ? config.available.includes(card.value) : true;
                }).map((card) => (
                  <button
                    key={card.value}
                    type="button"
                    onClick={() => {
                      setScanModes([card.value]);
                      if (card.value !== 'POS') {
                        setPosSystem('');
                      }
                      return;
                    }}
                    className={`text-left rounded-lg border p-4 transition-colors focus:outline-none ${
                      scanModes.includes(card.value)
                        ? 'border-emerald-500 ring-2 ring-emerald-200'
                        : 'border-gray-200 hover:border-gray-500'
                    }`}
                  >
                    <div className="text-2xl mb-3">{card.icon}</div>
                    <div className="font-semibold text-gray-900 mb-1">{card.title}</div>
                    <div className="text-xs text-gray-600">{card.description}</div>
                  </button>
                ))}
              </div>

              {scanModes.includes('POS') && (
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Select POS System</label>
                  <select
                    value={posSystem}
                    onChange={(e) => setPosSystem(e.target.value)}
                    className="w-full bg-[#F5F5F7] border border-gray-200 text-gray-900 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="" disabled>Select POS System</option>
                    {POS_SYSTEM_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="text-xs bg-gray-200 hover:bg-gray-100 text-gray-900 rounded px-3 py-1.5"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleCreateTemplate}
                  disabled={!canCreate || isCreating}
                  className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 text-white rounded px-3 py-1.5"
                >
                  {isCreating ? 'Creating…' : 'Create Template'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
