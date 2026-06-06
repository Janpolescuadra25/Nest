import React from 'react';

interface Props {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  variant?: 'error' | 'warning' | 'info';
}

const VARIANTS = {
  error: {
    container: 'bg-red-900/40 border border-red-700 text-red-300',
    button: 'bg-red-800 text-red-100 hover:bg-red-700',
  },
  warning: {
    container: 'bg-amber-900/30 border border-amber-700 text-amber-300',
    button: 'bg-amber-800 text-amber-100 hover:bg-amber-700',
  },
  info: {
    container: 'bg-slate-800/40 border border-slate-700 text-slate-100',
    button: 'bg-slate-700 text-slate-100 hover:bg-slate-600',
  },
};

export default function ErrorCard({ message, onRetry, onDismiss, variant = 'error' }: Props) {
  const style = VARIANTS[variant] ?? VARIANTS.error;

  return (
    <div className={`rounded-lg p-4 space-y-3 ${style.container}`}>
      <p className="text-sm">{message}</p>
      {(onRetry || onDismiss) && (
        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className={`px-3 py-1.5 rounded text-xs font-medium ${style.button}`}
            >
              Retry
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-1.5 rounded text-xs font-medium bg-slate-700 text-slate-100 hover:bg-slate-600"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
