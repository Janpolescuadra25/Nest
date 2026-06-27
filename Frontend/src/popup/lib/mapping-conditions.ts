import type { MappingCondition, MappingConditionOperator, ScanData } from '../../types';
import type { DecodedMapping } from './je-builder';

function evaluateSingleCondition(
  condition: MappingCondition,
  scanData: ScanData,
): boolean {
  const rawValue = scanData[condition.field];
  if (rawValue === undefined || rawValue === null) return false;

  const { operator } = condition;
  const conditionValue = condition.value;

  const textOperators: ReadonlySet<MappingConditionOperator> = new Set([
    'contains', 'not_contains', 'begins_with', 'ends_with',
    'not_begins_with', 'not_ends_with',
  ]);

  if (textOperators.has(operator)) {
    const fieldStr = String(rawValue).toLowerCase();
    const condStr = String(conditionValue).toLowerCase();
    switch (operator) {
      case 'contains': return fieldStr.includes(condStr);
      case 'not_contains': return !fieldStr.includes(condStr);
      case 'begins_with': return fieldStr.startsWith(condStr);
      case 'not_begins_with': return !fieldStr.startsWith(condStr);
      case 'ends_with': return fieldStr.endsWith(condStr);
      case 'not_ends_with': return !fieldStr.endsWith(condStr);
    }
  }

  const fieldNum = Number(rawValue);
  const condNum = Number(conditionValue);
  if (Number.isNaN(fieldNum) || Number.isNaN(condNum)) return false;

  switch (operator) {
    case 'equals': return fieldNum === condNum;
    case 'not_equals': return fieldNum !== condNum;
    case 'greater_than': return fieldNum > condNum;
    case 'greater_than_or_equal': return fieldNum >= condNum;
    case 'less_than': return fieldNum < condNum;
    case 'less_than_or_equal': return fieldNum <= condNum;
  }

  return false;
}

export function evaluateConditions(
  conditions: MappingCondition[] | null | undefined,
  scanData: ScanData,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => evaluateSingleCondition(c, scanData));
}

export function resolveMapping(
  decoded: DecodedMapping[],
  field: string,
  scanValues: ScanData,
): DecodedMapping | undefined {
  const candidates = decoded
    .filter((m) => m.sourceField === field)
    .sort((a, b) => b.priority - a.priority);

  for (const candidate of candidates) {
    if (evaluateConditions(candidate.conditions, scanValues)) {
      return candidate;
    }
  }

  return undefined;
}
