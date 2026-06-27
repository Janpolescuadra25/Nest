const VALID_OPERATORS = new Set([
  'equals', 'not_equals', 'greater_than', 'greater_than_or_equal',
  'less_than', 'less_than_or_equal', 'contains', 'not_contains',
  'begins_with', 'ends_with', 'not_begins_with', 'not_ends_with',
]);

interface ValidationResult {
  valid: boolean;
  error?: string;
}

interface ConditionInput {
  field: unknown;
  operator: unknown;
  value: unknown;
}

export function validateMappingConditions(conditions: unknown): ValidationResult {
  if (conditions === null || conditions === undefined) return { valid: true };
  if (!Array.isArray(conditions)) return { valid: false, error: 'conditions must be an array or null' };

  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i] as ConditionInput;
    if (typeof c !== 'object' || c === null) {
      return { valid: false, error: `conditions[${i}] must be an object` };
    }

    const field = c.field;
    if (typeof field !== 'string' || field.trim() === '') {
      return { valid: false, error: `conditions[${i}].field must be a non-empty string` };
    }

    const operator = c.operator;
    if (typeof operator !== 'string' || !VALID_OPERATORS.has(operator)) {
      return { valid: false, error: `conditions[${i}].operator "${operator}" is not valid` };
    }

    const value = c.value;
    if (typeof value !== 'string' && typeof value !== 'number') {
      return { valid: false, error: `conditions[${i}].value must be a string or number` };
    }
  }

  return { valid: true };
}
