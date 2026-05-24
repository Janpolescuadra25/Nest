import React, { useState } from 'react';

interface Section {
  title: string;
  icon: string;
  bullets: string[];
}

const SECTIONS: Section[] = [
  {
    title: 'Getting Started',
    icon: '🚀',
    bullets: [
      'Step 1 — Connect QuickBooks in the Settings tab',
      'Step 2 — Navigate to a Toast POS report page and click Scan',
      'Step 3 — Go to Mapping, map each field to a QB account, then Preview and Sync',
    ],
  },
  {
    title: 'Mapping Guide',
    icon: '🗺️',
    bullets: [
      'Each mapping links a Toast field (e.g. "Food Sales") to a QuickBooks account',
      'Use Dr (Debit) for asset accounts like Checking or Undeposited Funds',
      'Use Cr (Credit) for revenue and liability accounts like Sales, Sales Tax Payable',
      'Click "Auto-Detect" to auto-suggest mappings from your scan data',
      'Use templates (Standard Daily, Full Service, Quick Service) as a starting point',
    ],
  },
  {
    title: 'Debits & Credits',
    icon: '⚖️',
    bullets: [
      'Revenue accounts → Credit (sales, income, fees)',
      'Asset accounts → Debit (bank, checking, undeposited funds)',
      'Liability accounts → Credit (sales tax payable, tips payable)',
      'Expense accounts → Debit (costs, discounts)',
      'Journal entries must balance: Total Debits = Total Credits',
    ],
  },
  {
    title: 'Rules Engine',
    icon: '⚙️',
    bullets: [
      'COMBINE — adds two fields together before mapping',
      'DEDUCT — subtracts one field from another (e.g. refunds from sales)',
      'THRESHOLD — only applies the mapping if the amount exceeds a threshold',
      'FORMULA — custom math expression using field values',
    ],
  },
  {
    title: 'Troubleshooting',
    icon: '🔧',
    bullets: [
      'QB not connected → Go to Settings and click "Connect to QuickBooks"',
      'Unbalanced entry → Check that debits and credits total the same amount',
      'Account not found → Click ↻ to refresh QB lists, or search by partial name',
      'Sync fails with error 2010 → Ensure account IDs are valid QB account IDs',
      'Token expired → Reconnect QuickBooks in Settings',
    ],
  },
  {
    title: 'Contact & Support',
    icon: '📬',
    bullets: [
      'For technical support, bugs, or feature requests, reach out to:',
      '✉️ paulescuadra25@gmail.com',
      'Created by John Paul O. Escuadra',
      'Made with ❤️ in the Philippines',
    ],
  },
];

interface Props {
  onClose: () => void;
}

export default function HelpPanel({ onClose }: Props) {
  const [openSection, setOpenSection] = useState<string | null>('Getting Started');

  return (
    <div className="absolute inset-0 z-40 bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">❓</span>
          <span className="text-white font-semibold text-sm">Help & Guide</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-xl leading-none transition-colors"
          aria-label="Close help"
        >
          ✕
        </button>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {SECTIONS.map((section) => (
          <div
            key={section.title}
            className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden"
          >
            <button
              type="button"
              onClick={() =>
                setOpenSection((prev) => (prev === section.title ? null : section.title))
              }
              className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-700/50 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm text-gray-200">
                <span>{section.icon}</span>
                <span className="font-medium">{section.title}</span>
              </span>
              <span className="text-gray-500 text-xs">
                {openSection === section.title ? '▲' : '▼'}
              </span>
            </button>

            {openSection === section.title && (
              <div className="px-3 pb-3 border-t border-gray-700/60">
                <ul className="mt-2 space-y-1.5">
                  {section.bullets.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                      <span className="text-cyan-500 shrink-0 mt-0.5">•</span>
                      {bullet.startsWith('✉️') ? (
                        <a
                          href="mailto:paulescuadra25@gmail.com"
                          className="text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                          {bullet}
                        </a>
                      ) : (
                        <span>{bullet}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-700 text-center">
        <p className="text-xs text-gray-600">
          Nest — Toast POS → QuickBooks sync
        </p>
        <p className="text-xs text-gray-700 mt-0.5">
          Created by John Paul O. Escuadra
        </p>
      </div>
    </div>
  );
}
