import React, { useState } from 'react';

// ── Sub-components ──────────────────────────────────────────────────────────────

function Step({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <div className="shrink-0 w-5 h-5 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-[10px] text-emerald-400 font-bold">
        {num}
      </div>
      <div>
        <p className="text-xs text-gray-700 font-semibold">{title}</p>
        <p className="text-[11px] text-gray-600 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-600 font-semibold mt-1">{children}</p>;
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[11px] text-gray-600">
      <span className="text-emerald-500 shrink-0 mt-0.5">•</span>
      <span>{children}</span>
    </li>
  );
}

function TabInfo({ icon, name, children }: { icon: string; name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 bg-gray-100 rounded-lg p-2">
      <span className="text-sm shrink-0">{icon}</span>
      <div>
        <p className="text-xs text-emerald-400 font-semibold">{name}</p>
        <p className="text-[11px] text-gray-600 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

function MappingRow({ field, account, side }: { field: string; account: string; side: string }) {
  const sideColor = side === 'Credit' ? 'text-emerald-400' : 'text-emerald-600';
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-600 flex-1 truncate">{field}</span>
      <span className="text-gray-600">→</span>
      <span className="text-emerald-400 flex-1 truncate text-right">{account}</span>
      <span className={`${sideColor} w-12 text-right`}>{side}</span>
    </div>
  );
}

// ── Section data ────────────────────────────────────────────────────────────────

interface Section {
  title: string;
  icon: string;
  content: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    title: 'Getting Started',
    icon: '🚀',
    content: (
      <div className="space-y-3">
        <p className="text-gray-600 text-xs font-medium">Welcome to Qyra! Here's how to go from zero to your first sync:</p>
        <div className="space-y-2.5">
          <Step num={1} title="Log In">
            Open the Qyra extension and sign in with your email and password. If you don't have an account yet, click <span className="text-emerald-400">"Request Access"</span> and an admin will approve you.
          </Step>
          <Step num={2} title="Connect QuickBooks">
            Go to the <span className="text-emerald-400">Settings</span> tab and click <span className="text-emerald-400">"Connect to QuickBooks"</span>. This opens an Intuit login page — authorize Qyra to access your QuickBooks company. You'll see a green "✅ QB Connected" banner when it's done.
          </Step>
          <Step num={3} title="Set Up a Location">
            In Settings, add a <span className="text-emerald-400">Location</span> (e.g., "Downtown Store"). This links your scan data to a specific business location. You can have multiple locations.
          </Step>
          <Step num={4} title="Scan a POS Report">
            Navigate to a POS report page (Toast, SALIDO, or Oracle) in your browser, or upload a vendor invoice/check image or Excel file. Then click the <span className="text-emerald-400">Scan</span> tab and scan. Qyra extracts the data automatically.
          </Step>
          <Step num={5} title="Map Your Fields">
            Go to the <span className="text-emerald-400">Mapping</span> tab. Each field (like "Food Sales" or "Credit Card Payments") needs to be linked to a QuickBooks account. Click <span className="text-emerald-400">"Auto-Detect"</span> for smart suggestions, or map them manually. Choose Debit or Credit for each field.
          </Step>
          <Step num={6} title="Preview & Sync">
            Go to the <span className="text-emerald-400">Preview</span> tab. You'll see your journal entry with all mapped amounts. Verify the totals balance (Debits = Credits), then click <span className="text-emerald-400">"Sync to QuickBooks"</span>. Your journal entry is now in QuickBooks! 🎉
          </Step>
        </div>
      </div>
    ),
  },
  {
    title: 'Understanding the Tabs',
    icon: '📑',
    content: (
      <div className="space-y-2">
        <TabInfo icon="🔍" name="Scan">
          Scans POS reports, vendor invoices, checks, or Excel files. Shows a summary of all extracted fields and values.
        </TabInfo>
        <TabInfo icon="🗺️" name="Mapping">
          Links each scan field to a QuickBooks account. This is where you tell Qyra which account each field belongs to.
        </TabInfo>
        <TabInfo icon="📊" name="Preview">
          Shows the final journal entry before syncing. You can edit amounts, change accounts, add entities (Customer/Vendor/Employee), assign classes, and toggle consolidation. The entry must balance before syncing.
        </TabInfo>
        <TabInfo icon="📦" name="QB Data">
          Browse your QuickBooks lists — Accounts, Classes, Customers, Vendors, Employees, Tax Codes. Useful for looking up account names and numbers.
        </TabInfo>
        <TabInfo icon="🔄" name="Sync">
          View your sync history — which scans were synced to QuickBooks, when, and the resulting Journal Entry IDs. Also shows any failed syncs with error messages.
        </TabInfo>
        <TabInfo icon="⚙️" name="Settings">
          Connect/disconnect QuickBooks, manage locations, and sign out. Also shows your QB connection status and token expiry.
        </TabInfo>
      </div>
    ),
  },
  {
    title: 'Mapping Guide',
    icon: '🗺️',
    content: (
      <div className="space-y-3">
<p className="text-gray-600 text-xs font-medium">Mappings tell Qyra which QuickBooks account each POS field belongs to.</p>

        <SubHeading>How Mapping Works</SubHeading>
        <p className="text-[11px] text-gray-600">
          Each mapping connects a <span className="text-emerald-400">source field</span> (left side) to a <span className="text-emerald-400">target account</span> in QuickBooks (right side). You also choose whether the amount is a <span className="text-emerald-400">Debit</span> or <span className="text-emerald-400">Credit</span>.
        </p>

        <SubHeading>Quick Tips</SubHeading>
        <ul className="space-y-1.5">
          <Bullet>Click <span className="text-emerald-400">"Auto-Detect"</span> to let Qyra suggest mappings based on field names and your QB account list</Bullet>
          <Bullet>Use <span className="text-emerald-400">templates</span> (Standard Daily, Full Service, Quick Service) as a starting point — you can customize after applying</Bullet>
          <Bullet>Each mapping can optionally include a <span className="text-emerald-400">Class</span> (for QB class tracking) and a <span className="text-emerald-400">Description</span> (shown on the journal entry line)</Bullet>
          <Bullet>Check <span className="text-emerald-400">"Keep Separate"</span> if a line should not be consolidated with others on the same account (e.g., you want to see each payment method individually)</Bullet>
          <Bullet>Mappings are saved <span className="text-emerald-400">per location</span> — set them up once and reuse every day</Bullet>
        </ul>

        <SubHeading>Common Mapping Examples</SubHeading>
        <div className="bg-[#F5F5F7] rounded-lg p-2 text-[10px] font-mono space-y-1">
          <MappingRow field="Revenue.Net Sales" account="Sales Revenue" side="Credit" />
          <MappingRow field="Revenue.Gratuity" account="Tips Collected" side="Credit" />
          <MappingRow field="Payments.Cash.Amount" account="Checking Account" side="Debit" />
          <MappingRow field="Payments.Credit Card.Amount" account="Undeposited Funds" side="Debit" />
          <MappingRow field="Tax.Sales Tax.Amount" account="Sales Tax Payable" side="Credit" />
          <MappingRow field="Discount.Total.Amount" account="Discounts Allowed" side="Debit" />
        </div>
      </div>
    ),
  },
  {
    title: 'Debits & Credits',
    icon: '⚖️',
    content: (
      <div className="space-y-3">
        <p className="text-gray-600 text-xs font-medium">Every journal entry must balance: Total Debits = Total Credits.</p>

        <SubHeading>Simple Rule of Thumb</SubHeading>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2">
            <p className="text-emerald-600 text-xs font-semibold mb-1">Debit (Dr)</p>
            <p className="text-[10px] text-gray-600">Money coming IN or expenses</p>
            <ul className="text-[10px] text-gray-600 mt-1 space-y-0.5">
              <li>• Bank accounts (Checking, Savings)</li>
              <li>• Undeposited Funds</li>
              <li>• Accounts Receivable</li>
              <li>• Discounts & Voids</li>
              <li>• Cash over/short</li>
            </ul>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2">
            <p className="text-emerald-400 text-xs font-semibold mb-1">Credit (Cr)</p>
            <p className="text-[10px] text-gray-600">Revenue or liabilities</p>
            <ul className="text-[10px] text-gray-600 mt-1 space-y-0.5">
              <li>• Sales Revenue</li>
              <li>• Tips Collected / Payable</li>
              <li>• Sales Tax Payable</li>
              <li>• Gift Card Liability</li>
              <li>• Service Charge Revenue</li>
            </ul>
          </div>
        </div>

        <SubHeading>Document Type Guide</SubHeading>
        <ul className="space-y-1.5">
          <Bullet><span className="text-emerald-600">Debit:</span> Payments section (Cash, Credit Card, etc.) — money received</Bullet>
          <Bullet><span className="text-emerald-600">Debit:</span> Cash Activity — cash coming in</Bullet>
          <Bullet><span className="text-emerald-600">Debit:</span> Discounts & Voids — contra-revenue</Bullet>
          <Bullet><span className="text-emerald-400">Credit:</span> Revenue & Net Sales — income earned</Bullet>
          <Bullet><span className="text-emerald-400">Credit:</span> Tips — tips collected (liability until paid out)</Bullet>
          <Bullet><span className="text-emerald-400">Credit:</span> Tax — sales tax collected (liability)</Bullet>
          <Bullet><span className="text-emerald-400">Credit:</span> Service Charges — additional revenue</Bullet>
        </ul>

        <SubHeading>What If It Doesn't Balance?</SubHeading>
        <p className="text-[11px] text-gray-600">
          Qyra shows a red <span className="text-red-600">imbalance warning</span> at the bottom of the Preview tab. Common causes: unmapped fields, rounding differences, or missing offset entries. Qyra can auto-fix rounding differences up to $0.02.
        </p>
      </div>
    ),
  },
  {
    title: 'Preview & Sync',
    icon: '📊',
    content: (
      <div className="space-y-3">
        <p className="text-gray-600 text-xs font-medium">The Preview tab is where you review and finalize your journal entry before sending it to QuickBooks.</p>

        <SubHeading>Header Fields</SubHeading>
        <ul className="space-y-1.5">
          <Bullet><span className="text-emerald-400">Date:</span> The transaction date for the journal entry. Defaults to today. Change it to match the report date.</Bullet>
          <Bullet><span className="text-emerald-400">Doc #:</span> Optional reference number (e.g., "SY-001"). Shows as DocNumber in QuickBooks.</Bullet>
          <Bullet><span className="text-emerald-400">Memo:</span> Private note attached to the entry. You can set a template in Settings per location (e.g., "Qyra sync — {'{date}'} — Downtown").</Bullet>
        </ul>

        <SubHeading>Line Items</SubHeading>
        <p className="text-[11px] text-gray-600">Each line has: Account, Name (entity), Description, Class, Tax Code, Debit, Credit.</p>
        <ul className="space-y-1.5">
          <Bullet><span className="text-emerald-400">Account:</span> Required. The QB account for this line. Search by name or number.</Bullet>
          <Bullet><span className="text-emerald-400">Name:</span> Optional. Assign a Customer, Vendor, or Employee to this line.</Bullet>
          <Bullet><span className="text-emerald-400">Class:</span> Optional. QB class tracking for this line.</Bullet>
          <Bullet><span className="text-emerald-400">Description:</span> Shown on the journal entry line in QB.</Bullet>
        </ul>

        <SubHeading>Consolidation</SubHeading>
        <p className="text-[11px] text-gray-600">
          Toggle <span className="text-emerald-400">"Consolidate"</span> to merge lines that share the same account + side + class. For example, three separate credit card payments all going to "Undeposited Funds" become one line. Lines marked "Keep Separate" in mappings won't be merged.
        </p>

        <SubHeading>Syncing</SubHeading>
        <p className="text-[11px] text-gray-600">
          Click <span className="text-emerald-400">"Sync to QuickBooks"</span> when the entry is balanced and all accounts are assigned. You'll see a confirmation with the Journal Entry ID. The entry is immediately visible in QuickBooks.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
          <p className="text-amber-600 text-[10px] font-semibold">⚠️ Important</p>
          <p className="text-[10px] text-gray-600">Syncing creates a real journal entry in QuickBooks. Always double-check the Preview before syncing. There is no undo — but you can delete the entry in QuickBooks if needed.</p>
        </div>
      </div>
    ),
  },
  {
    title: 'Rules Engine',
    icon: '⚙️',
    content: (
      <div className="space-y-3">
        <p className="text-gray-600 text-xs font-medium">Rules let you transform scan data before it becomes a journal entry line.</p>

        <div className="space-y-2">
          <div className="bg-gray-100 rounded-lg p-2">
            <p className="text-emerald-400 text-xs font-semibold">COMBINE</p>
            <p className="text-[11px] text-gray-600">Adds two or more fields together before mapping. Example: Combine "Food Sales" + "Beverage Sales" into a single "Total Sales" line.</p>
          </div>
          <div className="bg-gray-100 rounded-lg p-2">
            <p className="text-emerald-400 text-xs font-semibold">DEDUCT</p>
            <p className="text-[11px] text-gray-600">Subtracts one field from another. Example: Deduct "Refunds" from "Gross Sales" to get "Net Sales".</p>
          </div>
          <div className="bg-gray-100 rounded-lg p-2">
            <p className="text-emerald-400 text-xs font-semibold">THRESHOLD</p>
            <p className="text-[11px] text-gray-600">Only applies the mapping if the amount exceeds a threshold you set. Example: Only map "Cash Over/Short" if it's more than $5.00.</p>
          </div>
          <div className="bg-gray-100 rounded-lg p-2">
            <p className="text-emerald-400 text-xs font-semibold">FORMULA</p>
            <p className="text-[11px] text-gray-600">Custom math expression using field values. For advanced users who need specific calculations.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: 'Troubleshooting',
    icon: '🔧',
    content: (
      <div className="space-y-3">
        <div className="space-y-2">
          <TroubleshootItem problem="Scan returns no data" solution="Make sure you're on a supported POS report page (Toast Sales Summary, SALIDO Accounting Summary, or Oracle Daily Operations). Wait for the page to fully load before scanning." />
          <TroubleshootItem problem="QB not connected" solution='Go to Settings and click "Connect to QuickBooks". Complete the Intuit authorization flow. If it fails, try again — the auth link expires after 15 minutes.' />
          <TroubleshootItem problem="Unbalanced entry" solution="Check that all fields are mapped. Unmapped fields won't have accounts assigned. Look for the red imbalance warning at the bottom of Preview. Qyra auto-fixes rounding up to $0.02." />
          <TroubleshootItem problem="Account not found in dropdown" solution='Click the ↻ refresh button next to the account dropdown to re-fetch QB lists. You can also search by partial name or account number.' />
          <TroubleshootItem problem="Sync fails with QB error" solution="Common causes: invalid account ID, token expired, or QB requires a field you didn't fill. Check the error message — it usually tells you exactly what's wrong. Try reconnecting QB in Settings." />
          <TroubleshootItem problem="Token expired" solution='Go to Settings and reconnect QuickBooks. Tokens expire periodically — Qyra auto-refreshes them, but if the refresh token itself expires, you need to re-authorize.' />
          <TroubleshootItem problem="Negative amounts showing" solution="Qyra automatically flips the posting side for negative amounts (a negative Credit becomes a Debit, and vice versa). This is correct behavior — check that your mapping's Debit/Credit setting is right for the positive case." />
        </div>
      </div>
    ),
  },
  {
    title: 'Keyboard Shortcuts',
    icon: '⌨️',
    content: (
      <div className="space-y-2">
        <div className="bg-gray-100 rounded-lg p-2 space-y-1.5">
          <Shortcut keys="Ctrl+Shift+N" description="Open Qyra floating window (click extension icon)" />
          <Shortcut keys="Tab" description="Move between fields in the Preview table" />
          <Shortcut keys="Esc" description="Close this help panel" />
        </div>
        <p className="text-[10px] text-gray-600">More shortcuts coming in future updates.</p>
      </div>
    ),
  },
  {
    title: 'FAQ',
    icon: '💬',
    content: (
      <div className="space-y-2.5">
        <FAQItem q="Does Qyra modify my POS data?" a="No. Qyra only reads data from the POS page. It never writes, modifies, or deletes anything in your POS." />
        <FAQItem q="Can I undo a sync?" a="Qyra doesn't have an undo button, but you can delete the journal entry directly in QuickBooks Online. Find it by the DocNumber or date." />
        <FAQItem q="How often should I sync?" a="Typically once per day — after your POS report is finalized. Some businesses sync weekly. It's up to your accounting workflow." />
        <FAQItem q="Can I sync multiple locations?" a="Yes! Add each location in Settings, select the active location, and sync separately for each. Mappings are per-location." />
        <FAQItem q="What QB plan do I need?" a="Any QuickBooks Online plan that supports Journal Entries (Plus, Advanced). Simple Start and Essentials don't support journal entries." />
        <FAQItem q="Is my data secure?" a="Qyra uses JWT authentication, encrypted OAuth tokens, and never stores your QuickBooks credentials. All API calls use HTTPS. Tokens are stored in your PostgreSQL database." />
      </div>
    ),
  },
  {
    title: 'Contact & Support',
    icon: '📬',
    content: (
      <div className="space-y-3">
        <p className="text-gray-600 text-xs font-medium">Need help? Found a bug? Have a feature idea?</p>
        <div className="bg-gray-100 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span>✉️</span>
            <a
              href="mailto:support@qyra.space"
              className="text-emerald-400 hover:text-emerald-600 text-xs transition-colors"
            >
              support@qyra.space
            </a>
          </div>
          <p className="text-[11px] text-gray-600">Include your browser version, Qyra version (1.0.0), and steps to reproduce the issue.</p>
        </div>
        <div className="text-center pt-2 border-t border-gray-200/50">
          <p className="text-xs text-gray-600">Created by <a href="https://vortexsdo.com" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:underline">Vortex Studios</a></p>
          <p className="text-[10px] text-gray-600 mt-0.5">Made with ❤️ in the Philippines</p>
        </div>
      </div>
    ),
  },
];

// ── Helper sub-components ───────────────────────────────────────────────────────

function TroubleshootItem({ problem, solution }: { problem: string; solution: string }) {
  return (
    <div className="bg-gray-100 rounded-lg p-2">
      <p className="text-red-600 text-xs font-semibold">❌ {problem}</p>
      <p className="text-[11px] text-gray-600 mt-0.5">✅ {solution}</p>
    </div>
  );
}

function Shortcut({ keys, description }: { keys: string; description: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-gray-600">{description}</span>
      <kbd className="bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[10px] text-gray-600 font-mono">{keys}</kbd>
    </div>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <p className="text-xs text-gray-700 font-semibold">Q: {q}</p>
      <p className="text-[11px] text-gray-600 mt-0.5">{a}</p>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export default function HelpPanel({ onClose }: Props) {
  const [openSection, setOpenSection] = useState<string | null>('Getting Started');

  return (
    <div className="absolute inset-0 z-40 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">❓</span>
          <span className="text-gray-900 font-semibold text-sm">Help & Guide</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-600 hover:text-gray-900 text-xl leading-none transition-colors"
          aria-label="Close help"
        >
          ✕
        </button>
      </div>

      {/* Quick-start banner */}
      <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-200 flex-shrink-0">
        <p className="text-[10px] text-emerald-400 text-center">
          <span className="font-semibold">Quick start:</span> Settings → Connect QB → Scan → Map → Preview → Sync
        </p>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {SECTIONS.map((section) => (
          <div
            key={section.title}
            className="bg-white border border-gray-200 rounded-lg overflow-hidden"
          >
            <button
              type="button"
              onClick={() =>
                setOpenSection((prev) => (prev === section.title ? null : section.title))
              }
              className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm text-gray-700">
                <span>{section.icon}</span>
                <span className="font-medium">{section.title}</span>
              </span>
              <span className="text-gray-600 text-xs">
                {openSection === section.title ? '▲' : '▼'}
              </span>
            </button>

            {openSection === section.title && (
              <div className="px-3 pb-3 border-t border-gray-200">
                <div className="mt-2">
                  {section.content}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-200 text-center flex-shrink-0">
        <p className="text-[10px] text-gray-600">
          Qyra — Financial Automation
        </p>
        <p className="text-[10px] text-gray-700">
          Created by <a href="https://vortexsdo.com" target="_blank" rel="noopener noreferrer" className="hover:underline">Vortex Studios</a>
        </p>
      </div>
    </div>
  );
}
