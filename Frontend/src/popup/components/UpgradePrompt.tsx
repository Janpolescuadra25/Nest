import React from 'react';

interface UpgradePromptProps {
  message: string;
  onUpgrade: () => void;
}

export default function UpgradePrompt({ message, onUpgrade }: UpgradePromptProps) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
      <p>{message}</p>
      <button
        type="button"
        onClick={onUpgrade}
        className="mt-3 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600"
      >
        Upgrade Plan
      </button>
    </div>
  );
}
