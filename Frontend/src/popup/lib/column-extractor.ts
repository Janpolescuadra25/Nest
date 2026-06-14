import { fuzzyMatch, FUZZY_LOW_CONFIDENCE_THRESHOLD } from './fuzzy-matcher';
import type { ProductMapping, ExtractedLineItem } from '../../types';

export function extractLineItems(params: {
  lineItems: Record<string, string>[];
  columnMappings: Record<string, unknown>;
  productMappings: ProductMapping[];
  defaultPostingType: 'Credit' | 'Debit';
}): ExtractedLineItem[] {
  const {
    lineItems,
    columnMappings,
    productMappings,
    defaultPostingType,
  } = params;

  const productColumn = String(columnMappings.productColumn ?? '').trim();
  const amountColumn = String(columnMappings.amountColumn ?? '').trim();
  const descriptionColumn = String(columnMappings.descriptionColumn ?? '').trim();
  const classColumn = String(columnMappings.classColumn ?? '').trim();
  const taxCodeColumn = String(columnMappings.taxCodeColumn ?? '').trim();

  if (!productColumn || !amountColumn) {
    return [];
  }

  const normalizedMappings = productMappings.map((mapping) => ({
    key: mapping.productName?.trim().toLowerCase(),
    originalKey: mapping.productName?.trim(),
    mapping,
  }));

  return lineItems.reduce<ExtractedLineItem[]>((acc, row) => {
    const productName = String(row[productColumn] ?? '').trim();
    const amountRaw = String(row[amountColumn] ?? '').trim();
    const amountValue = parseFloat(amountRaw.replace(/[^0-9.-]+/g, ''));

    if (!productName || Number.isNaN(amountValue) || amountValue === 0) {
      return acc;
    }

    const description = descriptionColumn
      ? String(row[descriptionColumn] ?? '').trim() || productName
      : productName;

    const classId = classColumn
      ? String(row[classColumn] ?? '').trim() || null
      : null;

    const taxCodeId = taxCodeColumn
      ? String(row[taxCodeColumn] ?? '').trim() || null
      : null;

    const normalizedProductName = productName.trim().toLowerCase();
    const exactMatch = normalizedMappings.find((entry) => entry.key === normalizedProductName);
    let matchedMapping = exactMatch?.mapping ?? null;
    let fuzzyMatched = false;
    let lowConfidence = false;

    if (!matchedMapping && normalizedMappings.length > 0) {
      const candidates = normalizedMappings.map((entry) => entry.originalKey);
      const result = fuzzyMatch(productName, candidates);
      if (result) {
        matchedMapping = normalizedMappings[result.index].mapping;
        fuzzyMatched = true;
        lowConfidence = result.score < FUZZY_LOW_CONFIDENCE_THRESHOLD;
      }
    }

    const accountId = matchedMapping?.accountId ?? '';
    const accountName = '';
    const postingType = matchedMapping?.postingType ?? defaultPostingType;
    const matched = Boolean(matchedMapping);

    acc.push({
      productName,
      amount: amountValue,
      description,
      classId,
      taxCodeId,
      accountId,
      accountName,
      postingType,
      matched,
      fuzzyMatched,
      lowConfidence: fuzzyMatched ? lowConfidence : undefined,
    });

    return acc;
  }, []);
}

export function getAutoFillSummary(items: ExtractedLineItem[]): {
  total: number;
  mapped: number;
  unmapped: number;
} {
  const total = items.length;
  const mapped = items.filter((item) => item.matched).length;
  const unmapped = total - mapped;
  return { total, mapped, unmapped };
}
