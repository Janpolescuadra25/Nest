import React, { useState } from 'react';

interface Props {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  scanDate?: string;
}

type QuickOption = 'today' | 'yesterday' | 'weekstart' | 'monthstart' | 'monthend' | 'scandate' | 'custom';

function toYMD(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

export default function SmartDatePicker({ value, onChange, scanDate }: Props) {
  const [mode, setMode] = useState<QuickOption>('today');

  const handleQuick = (opt: QuickOption) => {
    setMode(opt);
    const now = new Date();
    if (opt === 'today') {
      onChange(toYMD(now));
    } else if (opt === 'yesterday') {
      now.setDate(now.getDate() - 1);
      onChange(toYMD(now));
    } else if (opt === 'weekstart') {
      now.setDate(now.getDate() - now.getDay());
      onChange(toYMD(now));
    } else if (opt === 'monthstart') {
      now.setDate(1);
      onChange(toYMD(now));
    } else if (opt === 'monthend') {
      now.setMonth(now.getMonth() + 1, 0);
      onChange(toYMD(now));
    } else if (opt === 'scandate' && scanDate) {
      onChange(scanDate);
    }
    // 'custom' — don't change value, show date input
  };

  const buttons: { id: QuickOption; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'weekstart', label: 'Wk Start' },
    { id: 'monthstart', label: 'Mo Start' },
    ...(scanDate ? [{ id: 'scandate' as QuickOption, label: 'Scan Date' }] : []),
    { id: 'custom', label: 'Custom' },
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {buttons.map((btn) => (
          <button
            key={btn.id}
            type="button"
            onClick={() => handleQuick(btn.id)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-all duration-150 ${
              mode === btn.id
                ? 'bg-emerald-700 border-emerald-500 text-white'
                : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-400 hover:text-gray-200'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>
      {mode === 'custom' ? (
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:border-emerald-500 focus:outline-none"
        />
      ) : (
        <div className="text-xs text-gray-500">📅 {value}</div>
      )}
    </div>
  );
}
