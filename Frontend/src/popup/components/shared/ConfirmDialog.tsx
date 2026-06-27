import React from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'default';
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'default',
}: ConfirmDialogProps) {
  if (!open) return null;

  const confirmColor = variant === 'danger'
    ? 'bg-red-600 hover:bg-red-500'
    : 'bg-cyan-700 hover:bg-cyan-600';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-80 shadow-xl">
        <h3 className="text-sm font-medium text-white mb-2">{title}</h3>
        <p className="text-xs text-gray-300 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`text-xs px-3 py-1.5 rounded text-white transition-colors ${confirmColor}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
