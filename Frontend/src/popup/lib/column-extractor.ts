import type { ProductMapping, ExtractedLineItem, MatchingRule } from '../../types';

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function evaluateProductMatch(
  inputName: string,
  catalogName: string,
  rule?: MatchingRule | null,
): { matched: boolean; confidence: number; matchType: string } {
  const normalizedInput = normalizeText(inputName);
  const normalizedCatalog = normalizeText(catalogName);

  const exactMatch = normalizedInput === normalizedCatalog;
  if (!rule) {
    if (exactMatch) {
      return { matched: true, confidence: 1.0, matchType: 'EXACT' };
    }

    if (normalizedInput.includes(normalizedCatalog)) {
      return { matched: true, confidence: 0.5, matchType: 'SUBSTRING' };
    }

    return { matched: false, confidence: 0, matchType: 'NONE' };
  }

  if (!rule.isActive) {
    return { matched: false, confidence: 0, matchType: 'DISABLED' };
  }

  const direction = rule.direction ?? 'either';
  const inputContainsCatalog = normalizedInput.includes(normalizedCatalog);
  const catalogContainsInput = normalizedCatalog.includes(normalizedInput);
  const inputStartsWithCatalog = normalizedInput.startsWith(normalizedCatalog);
  const catalogStartsWithInput = normalizedCatalog.startsWith(normalizedInput);

  switch (rule.type) {
    case 'EXACT':
      return exactMatch
        ? { matched: true, confidence: 1.0, matchType: 'EXACT' }
        : { matched: false, confidence: 0, matchType: 'EXACT' };
    case 'CONTAINS': {
      const matches =
        direction === 'input_contains_catalog'
          ? inputContainsCatalog
          : direction === 'catalog_contains_input'
            ? catalogContainsInput
            : inputContainsCatalog || catalogContainsInput;
      return matches
        ? { matched: true, confidence: 1.0, matchType: 'CONTAINS' }
        : { matched: false, confidence: 0, matchType: 'CONTAINS' };
    }
    case 'STARTS_WITH': {
      const matches =
        direction === 'input_contains_catalog'
          ? inputStartsWithCatalog
          : direction === 'catalog_contains_input'
            ? catalogStartsWithInput
            : inputStartsWithCatalog || catalogStartsWithInput;
      return matches
        ? { matched: true, confidence: 1.0, matchType: 'STARTS_WITH' }
        : { matched: false, confidence: 0, matchType: 'STARTS_WITH' };
    }
    case 'REGEX': {
      if (!rule.pattern) {
        return { matched: false, confidence: 0, matchType: 'REGEX' };
      }
      try {
        const regex = new RegExp(rule.pattern, 'i');
        const matches = regex.test(inputName) || regex.test(catalogName);
        return matches
          ? { matched: true, confidence: 1.0, matchType: 'REGEX' }
          : { matched: false, confidence: 0, matchType: 'REGEX' };
      } catch {
        return { matched: false, confidence: 0, matchType: 'REGEX' };
      }
    }
    default:
      return { matched: false, confidence: 0, matchType: 'UNKNOWN' };
  }
}

export function extractLineItems(params: {
  lineItems: Record<string, string>[];
  columnMappings: Record<string, unknown> | null;
  productMappings: ProductMapping[];
  defaultPostingType: 'Credit' | 'Debit';
}): ExtractedLineItem[] {
  const {
    lineItems,
    columnMappings,
    productMappings,
    defaultPostingType,
  } = params;

  if (!columnMappings) {
    return [];
  }

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
    const rawProductValue = row[productColumn] as unknown;
    const productName = String(
      rawProductValue && typeof rawProductValue === 'object' && rawProductValue !== null
        ? (rawProductValue as any).productName ?? (rawProductValue as any).product?.name ?? (rawProductValue as any).name ?? ''
        : rawProductValue ?? ''
    ).trim();
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
    const matchEvaluations = normalizedMappings.map((entry) => {
      const result = evaluateProductMatch(productName, entry.originalKey, entry.mapping.matchingRule);
      return {
        mapping: entry.mapping,
        ...result,
      };
    });

    const bestMatch = matchEvaluations.reduce((best, current) => {
      if (!current.matched) return best;
      if (!best.matched) return current;
      if (current.confidence > best.confidence) return current;
      if (current.confidence === best.confidence) {
        const precedence = ['EXACT', 'CONTAINS', 'STARTS_WITH', 'REGEX', 'SUBSTRING'];
        const currentRank = precedence.indexOf(current.matchType);
        const bestRank = precedence.indexOf(best.matchType);
        return currentRank < bestRank ? current : best;
      }
      return best;
    }, { matched: false, confidence: 0, matchType: 'NONE', mapping: null as ProductMapping | null });

    const matchedMapping = bestMatch.mapping;
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
