import { parseNumericValue } from './parse-numeric-value';
import { resolveMapping } from './mapping-conditions';
import type { Mapping, MappingCondition, ScanData, ScanEntry, QBJournalLineItem } from '../../types';
import type { QBAccount } from '../types/qb';

// ── Decoded mapping ───────────────────────────────────────────────────────────

export interface DecodedMapping {
  sourceField: string;
  accountId: string;
  postingType: 'Debit' | 'Credit';
  classId?: string;
  description?: string;
  keepSeparate?: boolean;
  priority: number;
  conditions?: MappingCondition[] | null;
}

// ── JE Payload ────────────────────────────────────────────────────────────────

export interface JEPayload {
  scanRecordId: string;
  txnDate: string;
  lines: QBJournalLineItem[];
  privateNote?: string;
  docNumber?: string;
  balanced: boolean;
  totalDebits: number;
  totalCredits: number;
  imbalanceAmount: number;
}

// ── guessPostingType ──────────────────────────────────────────────────────────
// Regex-based heuristic for determining posting side when no mapping exists.

export function guessPostingType(field: string): 'debit' | 'credit' {
  const section = field.toLowerCase().split('.')[0]?.trim() ?? '';
  const lower = field.toLowerCase();

  // Cash Activity: most items are Debit (cash coming in), but tips paid out are Credit
  if (section === 'cash activity') {
    if (/credit.*tip|non-cash tip|tip.*paid/i.test(lower)) return 'credit';
    return 'debit';
  }

  // Tips: most items are Credit (tips received), but tips paid out are Debit
  if (section === 'tips') {
    if (/paid out|paid.*out|cash.*tip/i.test(lower)) return 'debit';
    return 'credit';
  }

  // Payments: always Debit (money coming IN)
  if (/^(payments|cash summary)$/.test(section)) return 'debit';

  // Revenue / Sales: always Credit
  if (/^(revenue|net sales|sales category|revenue center|service daypart|dining option|service mode|deferred)$/.test(section)) return 'credit';

  // Tax, Service Charge: Credit
  if (/^(tax|service charge)$/.test(section)) return 'credit';

  // Discount, Void: Debit (contra-revenue)
  if (/^(discount|void)$/.test(section)) return 'debit';

  // Unpaid Orders: Debit (Accounts Receivable)
  if (/^(unpaid orders)$/.test(section)) return 'debit';

  // Specific patterns MUST come before generic/fallback patterns to prevent incorrect matches
  // (e.g., "Credit Card Tips" must match credit, not the generic "credit card" debit pattern)
  if (/(credit\s*card\s*tips|cc\s*tips)/i.test(lower)) return 'credit';
  if (/(gift\s*card[^s]|gift\s*cards?\s*(sold|redeemed|revenue))/i.test(lower)) return 'credit';

  // Fallback: keyword matching on the full field name
  if (/cash|credit card|debit card|gift card|discount|refund|void|comp\b|net sales|total/.test(lower)) return 'debit';
  if (/sales|revenue|income|tax|tip|gratuity|fee|charge/.test(lower)) return 'credit';

  return 'debit';
}

// ── decodeMapping ─────────────────────────────────────────────────────────────
// Parses targetMemo JSON for overrides, normalizes postingType and classId.

export function decodeMapping(m: Mapping): DecodedMapping {
  let postingType: 'Debit' | 'Credit' = (m.postingType === 'Debit' || m.postingType === 'Credit') ? m.postingType : 'Credit';
  let classId: string | undefined = m.targetClass ?? undefined;
  let keepSeparate: boolean = m.keepSeparate ?? false;

  try {
    if (m.targetMemo) {
      const extra = JSON.parse(m.targetMemo) as { postingType?: string; classId?: string; keepSeparate?: boolean };
      if (m.postingType === undefined && (extra.postingType === 'Debit' || extra.postingType === 'Credit')) {
        postingType = extra.postingType;
      }
      if (m.keepSeparate === undefined && extra.keepSeparate !== undefined) {
        keepSeparate = extra.keepSeparate;
      }
    }
  } catch { /* ignore */ }

  return {
    sourceField: m.sourceField,
    accountId: m.targetAccount,
    postingType,
    classId,
    description: m.targetDescription ?? undefined,
    keepSeparate,
    priority: m.priority ?? 0,
    conditions: (m.conditions as MappingCondition[] | null) ?? null,
  };
}

// ── buildJEPayload ────────────────────────────────────────────────────────────
// Converts raw scan data + mappings + QB accounts into a QBJournalLineItem[]
// ready to POST to /api/quickbooks/journal-entry or /sync-batch.
// Entity refs are NOT included — those are manual per-line UI overrides.

export function buildJEPayload(params: {
  scanRecordId: string;
  scanData: ScanData;
  mappings: Mapping[];
  accounts: QBAccount[];
  txnDate: string;
  privateNote?: string;
  docNumber?: string;
  scanEntry?: ScanEntry;
}): JEPayload {
  const { scanRecordId, scanData, mappings, accounts, txnDate, privateNote, docNumber, scanEntry } = params;
  const decoded = mappings.map(decodeMapping);

  const scanFields: ScanData = scanEntry
    ? Object.fromEntries(
        Object.entries(scanEntry.lineItems?.[0] ?? {})
          .map(([key, value]) => [key, parseNumericValue(value)])
          .filter(([, value]) => !Number.isNaN(value)),
      ) as ScanData
    : scanData;

  const jeLines: QBJournalLineItem[] = Object.entries(scanFields)
    .filter(([, amount]) => amount !== 0)
    .map(([field, amount]) => {
      const mapping = resolveMapping(decoded, field, scanFields);
      const rawSide = mapping
        ? mapping.postingType.toLowerCase() as 'debit' | 'credit'
        : guessPostingType(field);
      // Negative amount flips the posting side
      const side = amount < 0
        ? (rawSide === 'debit' ? 'credit' : 'debit')
        : rawSide;
      const accountId = mapping?.accountId ?? '';
      const accountName = accounts.find((a) => a.Id === accountId)?.FullyQualifiedName ?? '';
      const description = mapping?.description ?? field;
      const classId = mapping?.classId;

      return {
        amount: Math.abs(amount),
        postingType: side === 'debit' ? 'Debit' : 'Credit',
        accountRef: { value: accountId, name: accountName || undefined },
        description: description || undefined,
        classRef: classId ? { value: classId } : undefined,
      };
    });

  const totalDebits = jeLines
    .filter((line) => line.postingType === 'Debit')
    .reduce((sum, line) => sum + line.amount, 0);
  const totalCredits = jeLines
    .filter((line) => line.postingType === 'Credit')
    .reduce((sum, line) => sum + line.amount, 0);
  const imbalanceAmount = totalDebits - totalCredits;
  const balanced = Math.abs(imbalanceAmount) <= 0.01;

  return {
    scanRecordId,
    txnDate,
    lines: jeLines,
    privateNote,
    docNumber,
    balanced,
    totalDebits,
    totalCredits,
    imbalanceAmount,
  };
}
