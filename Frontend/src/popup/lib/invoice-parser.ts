import type { ExtractedInvoice } from '../../types';

export function parseInvoiceText(rawText: string): ExtractedInvoice {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  const header: Record<string, string> = {};
  const lineItems: Record<string, string>[] = [];

  header.vendor = extractVendorName(lines);
  header.invoiceNumber = extractInvoiceNumber(rawText);
  header.invoiceDate = extractDate(rawText, ['invoice date', 'date', 'inv date']);
  header.dueDate = extractDate(rawText, ['due date', 'due', 'payment due']);
  header.total = extractTotal(lines, rawText);

  const extractedItems = extractLineItems(lines);
  lineItems.push(...extractedItems);

  return { header, lineItems };
}

function cleanupVendorName(vendor: string): string {
  let cleaned = vendor.trim().replace(/\s+/g, ' ');
  const suffixMatch = cleaned.match(/(LTD|LLC|INC|CO|CORP|LIMITED|PLC)$/i);
  if (suffixMatch && suffixMatch.index !== undefined) {
    const beforeSuffix = cleaned.slice(0, suffixMatch.index);
    if (beforeSuffix.length > 0 && !/\s$/.test(beforeSuffix)) {
      cleaned = `${beforeSuffix} ${suffixMatch[1]}`;
    }
  }
  return cleaned;
}

function extractVendorName(lines: string[]): string {
  for (const line of lines) {
    const soldByMatch = line.match(/^sold\s*by\s+(.+)/i);
    if (soldByMatch && soldByMatch[1]) {
      return cleanupVendorName(soldByMatch[1]);
    }
  }

  const suffixPattern = /\b(\w{3,}?)\s*(LTD|LLC|INC|CO|CORP|LIMITED|PLC)\s*$/i;
  for (const line of lines) {
    const match = line.match(suffixPattern);
    if (match && match[1] && match[2]) {
      return cleanupVendorName(`${match[1].trim()} ${match[2].trim()}`);
    }
  }

  const skipPrefixes = [
    'invoice', 'bill', 'receipt', 'date', 'order', 'total', 'subtotal', 'tax', 'vat', 'due', 'page', 'thank',
    'shipping', 'payment', 'reference', 'description', 'qty', 'quantity', 'price', 'amount', 'item', 'unit',
  ];

  for (const line of lines.slice(0, 10)) {
    const normalized = line.trim();
    if (normalized.length < 3) continue;
    if (/^\d/.test(normalized)) continue;
    if (/^[\d\s\-\.,]+$/.test(normalized)) continue;
    if (/^(tel|phone|fax|www|http)/i.test(normalized)) continue;
    if (/^[A-Z]\d{1,2}\s+\d[A-Z]{2}$/i.test(normalized)) continue;
    const digitRatio = (normalized.replace(/[^\d]/g, '').length / normalized.length) || 0;
    if (digitRatio > 0.6) continue;
    if (skipPrefixes.some((prefix) => normalized.toLowerCase().startsWith(`${prefix} `) || normalized.toLowerCase() === prefix)) continue;
    return cleanupVendorName(normalized);
  }

  return '';
}

function extractInvoiceNumber(text: string): string {
  const patterns = [
    /invoice\s*(?:#|no\.?|number)?\s*[:\-]?\s*([A-Z0-9\-]{6,})/i,
    /(?:#|no\.?|number)\s*[:\-]?\s*([A-Z0-9\-]{6,})/i,
    /(?:ref|reference|po|purchase\s*order)\s*(?:#|no\.?|number)?\s*[:\-]?\s*([A-Z0-9\-]{6,})/i,
    /([A-Z]{2}\d{6,})/i,
  ];

  const commonWords = new Set([
    'invoice', 'amazon', 'order', 'total', 'subtotal', 'tax', 'price', 'amount', 'page', 'date',
  ]);

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (candidate.length < 6) continue;
      if (!/\d/.test(candidate)) continue;
      if (commonWords.has(candidate.toLowerCase())) continue;
      return candidate;
    }
  }

  return '';
}

function extractDate(text: string, labels: string[]): string {
  const datePatterns = [
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
    /(\d{1,2}-\d{1,2}-\d{2,4})/,
    /(\w+ \d{1,2},?\s*\d{4})/,
    /(\d{1,2}\s+\w+\s+\d{2,4})/,
  ];

  for (const label of labels) {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(label)) {
        const searchArea = lines.slice(i, i + 3).join(' ');
        for (const dp of datePatterns) {
          const dateMatch = searchArea.match(dp);
          if (dateMatch && dateMatch[1]) return dateMatch[1].trim();
        }
      }
    }
  }
  return '';
}

function extractTotal(lines: string[], text: string): string {
  const keywords = [
    'total', 'amount due', 'balance due', 'grand total', 'invoice total', 'net total',
  ];
  const amountPattern = /[£$€₹]?\d{1,3}(?:[,.]\d{3})*(?:\.\d{2})/;
  const followTaxPattern = /(tax|vat|gst|hst)/i;
  let lastMatch = '';
  let lastPriority = -1;

  const keywordPriority: Record<string, number> = {
    'grand total': 4,
    'invoice total': 4,
    'total': 3,
    'amount due': 3,
    'balance due': 3,
    'net total': 2,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const normalized = line.toLowerCase();
    for (const keyword of keywords) {
      if (!normalized.includes(keyword)) continue;
      let candidate = '';
      let amountLine = line;
      const amountMatch = line.match(amountPattern);
      if (amountMatch) {
        candidate = amountMatch[0];
      } else if (i + 1 < lines.length) {
        const nextLineMatch = lines[i + 1].match(amountPattern);
        if (nextLineMatch) {
          candidate = nextLineMatch[0];
          amountLine = lines[i + 1];
        }
      }
      if (!candidate && i + 2 < lines.length) {
        const nextLineMatch = lines[i + 2].match(amountPattern);
        if (nextLineMatch) {
          candidate = nextLineMatch[0];
          amountLine = lines[i + 2];
        }
      }
      if (!candidate) continue;
      const amountIndex = amountLine.indexOf(candidate);
      const afterAmount = amountLine.slice(amountIndex + candidate.length, amountIndex + candidate.length + 20);
      if (followTaxPattern.test(afterAmount)) continue;
      if (keyword.includes('subtotal') || keyword.includes('net')) {
        if (lastPriority > keywordPriority[keyword]) continue;
      }
      const priority = keywordPriority[keyword] ?? 1;
      if (priority > lastPriority || priority === lastPriority) {
        lastMatch = candidate;
        lastPriority = priority;
      }
    }
  }

  return lastMatch.trim();
}

function extractLineItems(lines: string[]): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  const exclusionTerms = [
    'invoice', 'bill', 'receipt', 'date', 'order total', 'total', 'subtotal', 'sub-total', 'tax', 'vat', 'gst', 'hst',
    'due', 'page', 'thank', 'shipping', 'delivery', 'payment', 'reference', 'description', 'qty', 'quantity', 'price',
    'amount', 'item', 'unit', 'grand total', 'balance', 'discount', 'promotional', 'savings',
  ];
  const itemPattern = /^(.+?)\s+(\d+)\s*[x*×]\s+([£$€₹]?\d{1,3}(?:[,.]\d{3})*(?:\.\d{2}))(?:\s+([£$€₹]?\d{1,3}(?:[,.]\d{3})*(?:\.\d{2})))?$/;
  const previousTotalPattern = /(total|tax|vat|gst|subtotal|grand total|balance due|amount due)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lower = line.toLowerCase();
    if (exclusionTerms.some((term) => lower === term || lower.startsWith(`${term} `) || lower.includes(` ${term} `))) continue;
    if (i > 0 && previousTotalPattern.test(lines[i - 1])) continue;
    const match = line.match(itemPattern);
    if (!match) continue;
    const description = match[1].trim();
    const quantity = match[2].trim();
    const unitPrice = match[3].trim();
    const total = match[4]?.trim() ?? '';
    if (!/[a-z]/i.test(description)) continue;
    items.push({ description, quantity, unitPrice, total });
  }

  return items;
}
