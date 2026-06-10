import type { ExtractedInvoice } from '../../types';

export function parseInvoiceText(rawText: string): ExtractedInvoice {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  const header: Record<string, string> = {};
  const lineItems: Record<string, string>[] = [];

  header.vendor = extractVendorName(lines);
  header.invoiceNumber = extractInvoiceNumber(rawText);
  header.invoiceDate = extractDate(rawText, ['invoice date', 'date', 'inv date']);
  header.dueDate = extractDate(rawText, ['due date', 'due', 'payment due']);
  header.total = extractTotal(rawText);

  const extractedItems = extractLineItems(lines);
  lineItems.push(...extractedItems);

  return { header, lineItems };
}

function extractVendorName(lines: string[]): string {
  for (const line of lines.slice(0, 10)) {
    if (line.length < 3) continue;
    if (/^\d/.test(line)) continue;
    if (/^[\d\s\-\.,]+$/.test(line)) continue;
    if (/^(tel|phone|fax|www|http)/i.test(line)) continue;
    return line;
  }
  return '';
}

function extractInvoiceNumber(text: string): string {
  const patterns = [
    /invoice\s*(?:no|number|#|num)?[\s:.#\-]*\s*([A-Z0-9\-]+)/i,
    /inv\s*(?:no|number|#)?[\s:.#\-]*\s*([A-Z0-9\-]+)/i,
    /bill\s*(?:no|number|#)?[\s:.#\-]*\s*([A-Z0-9\-]+)/i,
    /order\s*(?:no|number|#)?[\s:.#\-]*\s*([A-Z0-9\-]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].trim();
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

function extractTotal(text: string): string {
  const pattern = /(?:total|balance\s*due|amount\s*due|grand\s*total|net\s*due)[\s:.]*\$?\s*([\d,]+\.?\d*)/i;
  let lastMatch = '';
  let match;
  while ((match = pattern.exec(text)) !== null) {
    lastMatch = match[1].trim();
  }
  return lastMatch;
}

function extractLineItems(lines: string[]): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  const amountPattern = /\$?\s*([\d,]+\.\d{2})\s*$/;
  const quantityPattern = /(\d+)\s*(?:x|@|×)\s*/;

  for (const line of lines) {
    const amountMatch = line.match(amountPattern);
    if (amountMatch) {
      let description = line.substring(0, amountMatch.index).trim();
      const amount = amountMatch[1];

      if (/^(total|subtotal|tax|discount|shipping|freight|delivery|balance)/i.test(description)) continue;
      if (description.length < 2) continue;

      const qtyMatch = description.match(quantityPattern);
      const quantity = qtyMatch ? qtyMatch[1] : '';

      if (qtyMatch && qtyMatch.index != null) {
        description = description.substring(0, qtyMatch.index).trim() +
          ' ' +
          description.substring(qtyMatch.index + qtyMatch[0].length).trim();
      }

      const item: Record<string, string> = { description, amount };
      if (quantity) item.quantity = quantity;

      items.push(item);
    }
  }

  return items;
}
