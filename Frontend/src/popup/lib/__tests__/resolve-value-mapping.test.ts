import { describe, it, expect } from 'vitest';
import { resolveValueMapping } from '../resolve-value-mapping';

describe('resolveValueMapping', () => {
  const baseEntityLookup = (id: string) => ({ Id: id, DisplayName: `Entity ${id}` });

  it('returns only null sourceField rows when sourceField is omitted', () => {
    const mappings = [
      { id: '1', templateId: 't', fieldType: 'name', scannedText: 'A', sourceField: null, entityId: 'e1', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: '2', templateId: 't', fieldType: 'name', scannedText: 'A', sourceField: 'payee', entityId: 'e2', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ] as any;

    const result = resolveValueMapping('A', 'name', mappings, baseEntityLookup);
    expect(result.matched).toBe(true);
    expect(result.entityId).toBe('e1');
  });

  it('returns both null and undefined sourceField rows when sourceField is omitted', () => {
    const mappings = [
      { id: '1', templateId: 't', fieldType: 'name', scannedText: 'A', sourceField: null, entityId: 'e1', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: '2', templateId: 't', fieldType: 'name', scannedText: 'A', entityId: 'e2', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ] as any;

    const result = resolveValueMapping('A', 'name', mappings, baseEntityLookup);
    expect(result.matched).toBe(true);
    expect(['e1', 'e2']).toContain(result.entityId);
  });

  it('legacy in-memory mapping with missing sourceField matches when sourceField is omitted', () => {
    const mappings = [
      { id: 'legacy-1', templateId: 't', fieldType: 'name', scannedText: 'A', entityId: 'e1', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' } as any,
    ];

    const result = resolveValueMapping('A', 'name', mappings, baseEntityLookup);
    expect(result.matched).toBe(true);
    expect(result.entityId).toBe('e1');
  });

  it('explicit null sourceField matches only null rows', () => {
    const mappings = [
      { id: '1', templateId: 't', fieldType: 'name', scannedText: 'A', sourceField: null, entityId: 'e1', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: '2', templateId: 't', fieldType: 'name', scannedText: 'A', entityId: 'e2', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ] as any;

    const result = resolveValueMapping('A', 'name', mappings, baseEntityLookup, null);
    expect(result.matched).toBe(true);
    expect(result.entityId).toBe('e1');
  });

  it('returns only payee sourceField rows when sourceField is payee', () => {
    const mappings = [
      { id: '1', templateId: 't', fieldType: 'name', scannedText: 'A', sourceField: 'payee', entityId: 'e1', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: '2', templateId: 't', fieldType: 'name', scannedText: 'A', sourceField: null, entityId: 'e2', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ] as any;

    const result = resolveValueMapping('A', 'name', mappings, baseEntityLookup, 'payee');
    expect(result.matched).toBe(true);
    expect(result.entityId).toBe('e1');
  });

  it('four columns do not cross-contaminate on sourceField', () => {
    const mappings = [
      { id: 'payee', templateId: 't', fieldType: 'name', scannedText: 'A', sourceField: 'payee', entityId: 'e-payee', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'bank', templateId: 't', fieldType: 'account', scannedText: 'A', sourceField: 'bankAccount', entityId: 'e-bank', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'category', templateId: 't', fieldType: 'account', scannedText: 'A', sourceField: 'category', entityId: 'e-category', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'tax', templateId: 't', fieldType: 'taxCode', scannedText: 'A', sourceField: 'taxType', entityId: 'e-tax', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ] as any;

    expect(resolveValueMapping('A', 'name', mappings, baseEntityLookup, 'payee').entityId).toBe('e-payee');
    expect(resolveValueMapping('A', 'account', mappings, baseEntityLookup, 'bankAccount').entityId).toBe('e-bank');
    expect(resolveValueMapping('A', 'account', mappings, baseEntityLookup, 'category').entityId).toBe('e-category');
    expect(resolveValueMapping('A', 'taxCode', mappings, baseEntityLookup, 'taxType').entityId).toBe('e-tax');
  });
});
