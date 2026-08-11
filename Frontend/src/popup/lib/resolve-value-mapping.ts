import { evaluateProductMatch } from './column-extractor';
import type { ValueMapping } from '../../types';

export interface ValueMappingResult {
  matched: boolean;
  entityId: string;
  entityName: string;
  confidence: number;
  matchedMappingId?: string;
}

/**
 * Try to resolve a scanned text value using value mappings.
 * Returns the best-matching entity or null if no mapping matches.
 */
export function resolveValueMapping(
  scannedText: string,
  fieldType: ValueMapping['fieldType'],
  valueMappings: ValueMapping[],
  entityLookup: (id: string) => { Id: string; FullyQualifiedName?: string; DisplayName?: string; Name?: string } | undefined,
  sourceField?: string | null,
): ValueMappingResult {
  if (!scannedText || !valueMappings.length) {
    return { matched: false, entityId: '', entityName: '', confidence: 0 };
  }

  let relevant = valueMappings.filter((m) => m.fieldType === fieldType);
  if (sourceField !== undefined) {
    relevant = relevant.filter((m) => m.sourceField === sourceField);
  } else {
    relevant = relevant.filter((m) => m.sourceField === null || m.sourceField === undefined);
  }

  if (!relevant.length) {
    return { matched: false, entityId: '', entityName: '', confidence: 0 };
  }

  let bestMatch: ValueMapping | null = null;
  let bestConfidence = 0;

  for (const vm of relevant) {
    const result = evaluateProductMatch(scannedText, vm.scannedText, vm.matchingRule);
    if (result.matched && result.confidence > bestConfidence) {
      bestMatch = vm;
      bestConfidence = result.confidence;
    }
  }

  if (!bestMatch) {
    return { matched: false, entityId: '', entityName: '', confidence: 0 };
  }

  const entity = entityLookup(bestMatch.entityId);
  const entityName = entity?.FullyQualifiedName || entity?.DisplayName || entity?.Name || bestMatch.entityId;

  return {
    matched: true,
    entityId: bestMatch.entityId,
    entityName,
    confidence: bestConfidence,
    matchedMappingId: bestMatch.id,
  };
}
