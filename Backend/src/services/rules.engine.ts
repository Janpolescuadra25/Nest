import { create, all } from 'mathjs';
import { RuleConfig } from '../types';

const ALLOWED_FACTORIES = new Set([
  // Arithmetic
  'add', 'subtract', 'multiply', 'divide',
  'abs', 'round', 'floor', 'ceil',
  'pow', 'sqrt', 'max', 'min',
  'log', 'log10', 'log2', 'mod', 'exp',
  'unaryMinus', 'unaryPlus',
  // Comparison
  'equal', 'unequal', 'smaller', 'larger', 'smallerEq', 'largerEq',
  'compare',
  // Logical
  'and', 'or', 'not',
  // Conditional & types
  'conditional', 'number', 'string', 'boolean', 'parenthesis',
]);

const safeFactories: Record<string, any> = {};
for (const [name, factory] of Object.entries(all)) {
  if (ALLOWED_FACTORIES.has(name)) {
    safeFactories[name] = factory;
  }
}
const safeMath = create(safeFactories);

export interface RuleDefinition {
  id: string;
  name: string;
  ruleType: 'COMBINE' | 'DEDUCT' | 'THRESHOLD' | 'FORMULA';
  config: RuleConfig;
  isActive: boolean;
}

/**
 * Apply a set of rules to raw Toast scan data fields.
 * Returns a transformed data object with computed fields added.
 */
export function applyRules(
  rawData: Record<string, number>,
  rules: RuleDefinition[]
): Record<string, number> {
  const result: Record<string, number> = { ...rawData };

  const activeRules = rules
    .filter((r) => r.isActive)
    .sort((a, b) => {
      // Apply DEDUCT rules last, COMBINE first
      const order = { COMBINE: 0, THRESHOLD: 1, FORMULA: 2, DEDUCT: 3 };
      return (order[a.ruleType] ?? 99) - (order[b.ruleType] ?? 99);
    });

  for (const rule of activeRules) {
    try {
      switch (rule.ruleType) {
        case 'COMBINE': {
          const { sourceFields, targetField } = rule.config;
          if (!sourceFields || !targetField) break;
          const combined = sourceFields.reduce((sum: number, field: string) => {
            return sum + (result[field] ?? 0);
          }, 0);
          result[targetField] = combined;
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[RulesEngine] COMBINE "${rule.name}": ${sourceFields.join(' + ')} = ${combined} → ${targetField}`);
          }
          break;
        }

        case 'DEDUCT': {
          const { sourceFields, targetField } = rule.config;
          if (!sourceFields || !targetField || sourceFields.length < 2) break;
          const base = result[sourceFields[0]] ?? 0;
          const deduction = sourceFields.slice(1).reduce((sum: number, field: string) => {
            return sum + (result[field] ?? 0);
          }, 0);
          result[targetField] = base - deduction;
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[RulesEngine] DEDUCT "${rule.name}": ${base} - ${deduction} = ${result[targetField]} → ${targetField}`);
          }
          break;
        }

        case 'THRESHOLD': {
          const { sourceFields, threshold, targetField } = rule.config;
          if (!sourceFields || threshold === undefined || !targetField) break;
          const value = result[sourceFields[0]] ?? 0;
          result[targetField] = value >= threshold ? value : 0;
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[RulesEngine] THRESHOLD "${rule.name}": ${value} >= ${threshold}? → ${result[targetField]}`);
          }
          break;
        }

        case 'FORMULA': {
          const { formula, targetField } = rule.config;
          if (!formula || !targetField) break;
          // Safe formula evaluation: replace field references with values
          const evaluatable = formula.replace(/\[([^\]]+)\]/g, (_: string, field: string) => {
            return String(result[field] ?? 0);
          });
          const compiled = safeMath.compile(evaluatable);
          const value = compiled.evaluate() as number;
          result[targetField] = value;
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[RulesEngine] FORMULA "${rule.name}": ${evaluatable} = ${value} → ${targetField}`);
          }
          break;
        }
      }
    } catch (err) {
      console.error(`[RulesEngine] Error applying rule "${rule.name}":`, err);
    }
  }

  return result;
}

export function applyRulesToLineItems(
  lineItems: Record<string, string>[],
  rules: RuleDefinition[]
): Record<string, string>[] {
  return lineItems.map((row) => {
    const numericRow: Record<string, number> = {};
    for (const [key, value] of Object.entries(row)) {
      const cleaned = String(value).replace(/[^0-9.\-]/g, '');
      const num = parseFloat(cleaned);
      if (!Number.isNaN(num)) {
        numericRow[key] = num;
      }
    }
    const transformed = applyRules(numericRow, rules);
    const targetFields = new Set(rules.map((r) => r.config.targetField));
    const resultRow: Record<string, string> = { ...row };
    for (const [key, value] of Object.entries(transformed)) {
      if (targetFields.has(key)) {
        resultRow[key] = String(value);
      }
    }
    return resultRow;
  });
}
