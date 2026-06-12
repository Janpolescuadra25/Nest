import React, { useState } from 'react';

interface InvoiceReviewPanelProps {
  header: Record<string, string>;
  lineItems: Record<string, string>[];
  confidence: number | null;
  onConfirm: (editedHeader: Record<string, string>, editedLineItems: Record<string, string>[]) => void;
  onRetry: () => void;
  onClear: () => void;
}

export default function InvoiceReviewPanel({ header, lineItems, confidence, onConfirm, onRetry, onClear }: InvoiceReviewPanelProps) {
  const [editHeader, setEditHeader] = useState<Record<string, string>>(header);
  const [editLineItems, setEditLineItems] = useState<Record<string, string>[]>(
    lineItems.length > 0 ? lineItems : [{ description: '', quantity: '', unitPrice: '', total: '' }],
  );

  const updateHeader = (key: string, value: string) => {
    setEditHeader((prev) => ({ ...prev, [key]: value }));
  };

  const updateLineItem = (index: number, key: string, value: string) => {
    setEditLineItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [key]: value };
      return updated;
    });
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
          { label: 'Vendor', key: 'vendor' },
          { label: 'Invoice #', key: 'invoiceNumber' },
          { label: 'Invoice Date', key: 'invoiceDate' },
          { label: 'Due Date', key: 'dueDate' },
          { label: 'Total', key: 'total' },
        ].map((field) => (
          <div key={field.key} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 items-center">
            <label className="text-gray-400 text-xs" htmlFor={field.key}>{field.label}</label>
            <input
              id={field.key}
              type="text"
              value={editHeader[field.key] ?? ''}
              onChange={(e) => updateHeader(field.key, e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="text-xs text-gray-500 font-medium">Line items</div>
        <div className="grid grid-cols-[1.5fr_56px_96px_96px] gap-2 text-xs text-gray-400 font-medium">
          <div>Description</div>
          <div>Qty</div>
          <div>Unit Price</div>
          <div>Total</div>
        </div>
        {editLineItems.map((item, index) => (
          <div key={index} className="grid grid-cols-[1.5fr_56px_96px_96px] gap-2 text-white">
            <input
              type="text"
              value={item.description ?? ''}
              onChange={(e) => updateLineItem(index, 'description', e.target.value)}
              className="flex-1 min-w-0 bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
            />
            <input
              type="number"
              min="0"
              value={item.quantity ?? ''}
              onChange={(e) => updateLineItem(index, 'quantity', e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
            />
            <input
              type="text"
              value={item.unitPrice ?? ''}
              onChange={(e) => updateLineItem(index, 'unitPrice', e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
            />
            <input
              type="text"
              value={item.total ?? ''}
              onChange={(e) => updateLineItem(index, 'total', e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        ))}
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => setEditLineItems((prev) => [...prev, { description: '', quantity: '', unitPrice: '', total: '' }])}
            className="text-xs text-cyan-400 hover:underline"
          >
            + Add Row
          </button>
          {editLineItems.length > 1 && (
            <button
              type="button"
              onClick={() => setEditLineItems((prev) => prev.slice(0, -1))}
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
          onClick={() => onConfirm(editHeader, editLineItems)}
          className="flex-1 bg-cyan-700 text-white rounded px-3 py-2 text-sm font-medium hover:bg-cyan-600"
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
