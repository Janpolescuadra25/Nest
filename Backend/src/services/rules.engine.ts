import { RuleConfig } from '../types';

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
          console.log(`[RulesEngine] COMBINE "${rule.name}": ${sourceFields.join(' + ')} = ${combined} → ${targetField}`);
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
          console.log(`[RulesEngine] DEDUCT "${rule.name}": ${base} - ${deduction} = ${result[targetField]} → ${targetField}`);
          break;
        }

        case 'THRESHOLD': {
          const { sourceFields, threshold, targetField } = rule.config;
          if (!sourceFields || threshold === undefined || !targetField) break;
          const value = result[sourceFields[0]] ?? 0;
          result[targetField] = value >= threshold ? value : 0;
          console.log(`[RulesEngine] THRESHOLD "${rule.name}": ${value} >= ${threshold}? → ${result[targetField]}`);
          break;
        }

        case 'FORMULA': {
          const { formula, targetField } = rule.config;
          if (!formula || !targetField) break;
          // Safe formula evaluation: replace field references with values
          const evaluatable = formula.replace(/\[([^\]]+)\]/g, (_: string, field: string) => {
            return String(result[field] ?? 0);
          });
          // Only allow basic math operators for security
          if (/[^0-9+\-*/().\s]/.test(evaluatable)) {
            console.warn(`[RulesEngine] FORMULA "${rule.name}": unsafe formula, skipping`);
            break;
          }
          // eslint-disable-next-line no-eval
          const value = Function(`"use strict"; return (${evaluatable})`)() as number;
          result[targetField] = value;
          console.log(`[RulesEngine] FORMULA "${rule.name}": ${evaluatable} = ${value} → ${targetField}`);
          break;
        }
      }
    } catch (err) {
      console.error(`[RulesEngine] Error applying rule "${rule.name}":`, err);
    }
  }

  return result;
}
