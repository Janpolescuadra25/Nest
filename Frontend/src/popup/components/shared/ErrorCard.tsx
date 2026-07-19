import React from 'react';

interface Props {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  variant?: 'error' | 'warning' | 'info';
}

const VARIANTS = {
  error: {
    container: 'bg-red-50 border border-red-300 text-red-600',
    button: 'bg-red-600 text-white hover:bg-red-500',
  },
  warning: {
    container: 'bg-amber-50 border border-amber-200 text-amber-700',
    button: 'bg-amber-600 text-white hover:bg-amber-500',
  },
  info: {
    container: 'bg-gray-100 border border-gray-200 text-gray-700',
    button: 'bg-gray-200 text-gray-900 hover:bg-gray-300',
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
              className="px-3 py-1.5 rounded text-xs font-medium bg-gray-200 text-gray-900 hover:bg-gray-300"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
