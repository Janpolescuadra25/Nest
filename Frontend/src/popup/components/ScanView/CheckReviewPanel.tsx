import React, { useState } from 'react';

interface CheckLineItem {
  description: string;
  amount: string;
}

interface CheckData {
  checkNumber: string;
  payeeName: string;
  amount: string;
  date: string;
  memo: string;
  bankName: string;
  lineItems: CheckLineItem[];
}

interface CheckReviewPanelProps {
  checkData: CheckData;
  confidence: number | null;
  onConfirm: (editedData: CheckData) => void;
  onRetry: () => void;
  onClear: () => void;
}

export default function CheckReviewPanel({ checkData, confidence, onConfirm, onRetry, onClear }: CheckReviewPanelProps) {
  const [editData, setEditData] = useState<CheckData>(checkData);

  const updateField = (key: keyof CheckData, value: string) => {
    setEditData((prev) => ({ ...prev, [key]: value }));
  };

  const updateLineItem = (index: number, key: keyof CheckLineItem, value: string) => {
    setEditData((prev) => {
      const updatedLineItems = [...prev.lineItems];
      updatedLineItems[index] = { ...updatedLineItems[index], [key]: value };
      return { ...prev, lineItems: updatedLineItems };
    });
  };

  const addLineItem = () => {
    setEditData((prev) => ({
      ...prev,
      lineItems: [...prev.lineItems, { description: '', amount: '' }],
    }));
  };

  const removeLastLineItem = () => {
    setEditData((prev) => ({
      ...prev,
      lineItems: prev.lineItems.length > 1 ? prev.lineItems.slice(0, -1) : prev.lineItems,
    }));
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-3">
      <div>
        <div className="text-sm font-semibold text-gray-200">Review OCR results</div>
        {confidence !== null && (
          <div className={`text-xs ${confidence < 50 ? 'text-red-400' : confidence < 75 ? 'text-yellow-400' : 'text-green-400'}`}>
            OCR Confidence: {Math.round(confidence)}%
          </div>
        )}
      </div>

      <div className="space-y-3">
        {[
          { label: 'Check #', key: 'checkNumber' },
          { label: 'Payee', key: 'payeeName' },
          { label: 'Amount', key: 'amount' },
          { label: 'Date', key: 'date' },
          { label: 'Bank Name', key: 'bankName' },
          { label: 'Memo', key: 'memo' },
        ].map((field) => (
          <div key={field.key} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 items-center">
            <label className="text-gray-400 text-xs" htmlFor={field.key}>{field.label}</label>
            <input
              id={field.key}
              type="text"
              value={String(editData[field.key as keyof CheckData] ?? '')}
              onChange={(e) => updateField(field.key as keyof CheckData, e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="text-xs text-gray-500 font-medium">Line items</div>
        <div className="grid grid-cols-[1.5fr_120px] gap-2 text-xs text-gray-400 font-medium">
          <div>Description</div>
          <div>Amount</div>
        </div>
        {editData.lineItems.map((item, index) => (
          <div key={index} className="grid grid-cols-[1.5fr_120px] gap-2 text-white">
            <input
              type="text"
              value={item.description ?? ''}
              onChange={(e) => updateLineItem(index, 'description', e.target.value)}
              className="flex-1 min-w-0 bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:border-emerald-500 focus:outline-none"
            />
            <input
              type="text"
              value={item.amount ?? ''}
              onChange={(e) => updateLineItem(index, 'amount', e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        ))}
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={addLineItem}
            className="text-xs text-emerald-400 hover:underline"
          >
            + Add Row
          </button>
          {editData.lineItems.length > 1 && (
            <button
              type="button"
              onClick={removeLastLineItem}
              className="text-xs text-red-400 hover:underline"
            >
              − Remove Last
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button
          type="button"
          onClick={() => onConfirm(editData)}
          className="flex-1 bg-emerald-700 text-white rounded px-3 py-2 text-sm font-medium hover:bg-emerald-600"
        >
          Use Results
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="border border-gray-600 text-gray-300 rounded px-3 py-2 text-sm hover:bg-gray-700"
        >
          Re-scan
        </button>
        <button
          type="button"
          onClick={onClear}
          className="text-gray-500 text-sm hover:text-gray-300 px-2"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
