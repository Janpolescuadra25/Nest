import { describe, it, expect } from 'vitest'
import { evaluateConditions, resolveMapping } from '../mapping-conditions'
import type { DecodedMapping } from '../je-builder'
import type { MappingCondition } from '../../../types'

const makeMapping = (
  req: { sourceField: string; accountId: string },
  extra?: { priority?: number; conditions?: MappingCondition[] }
): DecodedMapping =>
  ({
    sourceField: req.sourceField,
    accountId: req.accountId,
    postingType: 'Credit' as const,
    priority: 1,
    conditions: [],
    ...extra,
  } as DecodedMapping)

describe('evaluateConditions', () => {
  it('returns true when conditions is null', () => {
    expect(evaluateConditions(null, {})).toBe(true)
  })

  it('returns true when conditions is an empty array', () => {
    expect(evaluateConditions([], {})).toBe(true)
  })

  it('returns true for a matching numeric equals condition', () => {
    const conditions: MappingCondition[] = [
      { field: 'amount', operator: 'equals', value: 100 },
    ]
    expect(evaluateConditions(conditions, { amount: 100 })).toBe(true)
  })

  it('returns false for a failing numeric equals condition', () => {
    const conditions: MappingCondition[] = [
      { field: 'amount', operator: 'equals', value: 50 },
    ]
    expect(evaluateConditions(conditions, { amount: 100 })).toBe(false)
  })

  it('returns true when AND: both numeric conditions pass', () => {
    const conditions: MappingCondition[] = [
      { field: 'amount', operator: 'equals', value: 100 },
      { field: 'total', operator: 'greater_than', value: 150 },
    ]
    expect(evaluateConditions(conditions, { amount: 100, total: 200 })).toBe(true)
  })

  it('returns false when AND: one numeric condition fails', () => {
    const conditions: MappingCondition[] = [
      { field: 'amount', operator: 'equals', value: 100 },
      { field: 'total', operator: 'greater_than', value: 250 },
    ]
    expect(evaluateConditions(conditions, { amount: 100, total: 200 })).toBe(false)
  })

  it('matches contains text operator on numeric scan value via String() conversion', () => {
    const conditions: MappingCondition[] = [
      { field: 'amount', operator: 'contains', value: '10' },
    ]
    expect(evaluateConditions(conditions, { amount: 100 })).toBe(true)
  })

  it('evaluates greater_than numeric condition', () => {
    const conditions: MappingCondition[] = [
      { field: 'amount', operator: 'greater_than', value: 50 },
    ]
    expect(evaluateConditions(conditions, { amount: 100 })).toBe(true)
  })

  it('evaluates less_than numeric condition', () => {
    const conditions: MappingCondition[] = [
      { field: 'amount', operator: 'less_than', value: 200 },
    ]
    expect(evaluateConditions(conditions, { amount: 100 })).toBe(true)
  })
})

describe('resolveMapping', () => {
  it('returns undefined for empty mappings array', () => {
    expect(resolveMapping([], 'field', { field: 1 })).toBeUndefined()
  })

  it('returns undefined when no mapping has a matching sourceField', () => {
    const mappings = [makeMapping({ sourceField: 'other', accountId: 'acc-1' })]
    expect(resolveMapping(mappings, 'field', { field: 1 })).toBeUndefined()
  })

  it('returns single candidate with no conditions', () => {
    const mappings = [makeMapping({ sourceField: 'field', accountId: 'acc-a' })]
    const result = resolveMapping(mappings, 'field', { field: 1 })
    expect(result?.accountId).toBe('acc-a')
  })

  it('returns higher-priority mapping when both match conditions', () => {
    const mappings = [
      makeMapping({ sourceField: 'field', accountId: 'acc-low' }, { priority: 1 }),
      makeMapping({ sourceField: 'field', accountId: 'acc-high' }, { priority: 10 }),
    ]
    const result = resolveMapping(mappings, 'field', { field: 1 })
    expect(result?.accountId).toBe('acc-high')
  })

  it('falls through to lower priority when higher fails numeric equals condition', () => {
    const mappings = [
      makeMapping({ sourceField: 'field', accountId: 'acc-fallback' }, { priority: 1 }),
      makeMapping(
        { sourceField: 'field', accountId: 'acc-high' },
        {
          priority: 10,
          conditions: [{ field: 'field', operator: 'equals', value: 999 }],
        },
      ),
    ]
    const result = resolveMapping(mappings, 'field', { field: 1 })
    expect(result?.accountId).toBe('acc-fallback')
  })

  it('returns undefined when all candidates fail conditions', () => {
    const mappings = [
      makeMapping(
        { sourceField: 'field', accountId: 'acc-1' },
        { conditions: [{ field: 'field', operator: 'equals', value: 999 }] },
      ),
    ]
    const result = resolveMapping(mappings, 'field', { field: 1 })
    expect(result).toBeUndefined()
  })

  it('matches contains text operator on numeric scan value (String(100).includes("10"))', () => {
    const mappings = [
      makeMapping(
        { sourceField: 'field', accountId: 'acc-match' },
        { conditions: [{ field: 'field', operator: 'contains', value: '10' }] },
      ),
    ]
    const result = resolveMapping(mappings, 'field', { field: 100 })
    expect(result?.accountId).toBe('acc-match')
  })

  it('matches begins_with text operator on numeric scan value (String(100).startsWith("1"))', () => {
    const mappings = [
      makeMapping(
        { sourceField: 'field', accountId: 'acc-match' },
        { conditions: [{ field: 'field', operator: 'begins_with', value: '1' }] },
      ),
    ]
    const result = resolveMapping(mappings, 'field', { field: 100 })
    expect(result?.accountId).toBe('acc-match')
  })

  it('matches ends_with text operator on numeric scan value (String(100).endsWith("00"))', () => {
    const mappings = [
      makeMapping(
        { sourceField: 'field', accountId: 'acc-match' },
        { conditions: [{ field: 'field', operator: 'ends_with', value: '00' }] },
      ),
    ]
    const result = resolveMapping(mappings, 'field', { field: 100 })
    expect(result?.accountId).toBe('acc-match')
  })
})
