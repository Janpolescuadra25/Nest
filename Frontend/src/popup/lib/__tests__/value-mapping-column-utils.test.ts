import { describe, it, expect } from 'vitest';
import { buildChequeColumnConfigs, buildBillColumnConfigs, buildJournalEntryColumnConfigs, filterMappingsForColumn, getEffectiveFieldType, getEffectiveTargetOptions, buildValueMappingPayload } from '../value-mapping-column-utils';
import type { ColumnMappingConfig, ValueMapping, ValueMappingFormData, MatchingRule } from '../../../types';

describe('value-mapping-column-utils', () => {
  const mockOptions = {
    chequePayeeOptions: [
      { value: 'vendor-1', label: 'Vendor One', subtitle: 'Vendor' },
    ],
    chequeBankOptions: [
      { value: 'bank-1', label: 'Bank One', subtitle: 'Checking' },
    ],
    accountOptions: [
      { value: 'bank-1', label: 'Bank One', subtitle: 'Checking' },
      { value: 'acct-1', label: 'Account One', subtitle: 'Expense' },
    ],
    taxCodeOptions: [
      { value: 'tax-1', label: 'Tax One', subtitle: 'Standard' },
    ],
  };

  const mockBillOptions = {
    billVendorOptions: [
      { value: 'vendor-1', label: 'Vendor One', subtitle: 'Vendor' },
    ],
    apAccountOptions: [
      { value: 'ap-1', label: 'Accounts Payable', subtitle: 'Liability' },
    ],
    termsOptions: [
      { value: 'terms-1', label: 'Net 30', subtitle: 'Standard' },
    ],
  };

  const mockJEOptions = {
    jeAccountOptions: [
      { value: 'acct-1', label: 'Account One', subtitle: 'Expense' },
    ],
    jeNameOptions: [
      { value: 'vendor-1', label: 'Vendor One', subtitle: 'Vendor' },
    ],
    jeClassOptions: [
      { value: 'class-1', label: 'Class One', subtitle: 'Department' },
    ],
    jeTaxOptions: [
      { value: 'tax-1', label: 'Tax One', subtitle: 'Standard' },
    ],
  };

  it('buildChequeColumnConfigs returns 4 configs with correct metadata', () => {
    const configs = buildChequeColumnConfigs(mockOptions);

    expect(configs).toHaveLength(4);
    expect(configs.map((config) => config.sourceField)).toEqual(['payee', 'bankAccount', 'category', 'taxType']);
    expect(configs.map((config) => config.fieldType)).toEqual(['name', 'account', 'account', 'taxCode']);
    expect(configs.map((config) => config.label)).toEqual(['Payee', 'Bank Account', 'Category', 'Tax Type']);
    expect(configs.map((config) => config.description)).toEqual([
      'Map raw payee names from your Excel to QuickBooks vendors',
      'Map bank account names to QuickBooks Bank-type accounts',
      'Map category names to QuickBooks accounts',
      'Map tax type text to QuickBooks tax codes',
    ]);
    expect(configs[0].targetOptions).toBe(mockOptions.chequePayeeOptions);
    expect(configs[1].targetOptions).toBe(mockOptions.chequeBankOptions);
    expect(configs[2].targetOptions).toBe(mockOptions.accountOptions);
    expect(configs[3].targetOptions).toBe(mockOptions.taxCodeOptions);
    expect(configs[1].targetOptions).not.toBe(configs[2].targetOptions);
  });

  it('buildBillColumnConfigs returns 3 configs with correct metadata', () => {
    const configs = buildBillColumnConfigs(mockBillOptions);

    expect(configs).toHaveLength(3);
    expect(configs.map((config) => config.sourceField)).toEqual(['vendorRef', 'apAccountRef', 'termsRef']);
    expect(configs.map((config) => config.fieldType)).toEqual(['name', 'account', 'name']);
    expect(configs.map((config) => config.label)).toEqual(['Vendor', 'AP Account', 'Terms']);
    expect(configs[0].targetOptions).toBe(mockBillOptions.billVendorOptions);
    expect(configs[1].targetOptions).toBe(mockBillOptions.apAccountOptions);
    expect(configs[2].targetOptions).toBe(mockBillOptions.termsOptions);
  });

  it('buildBillColumnConfigs assigns correct target options to each column', () => {
    const configs = buildBillColumnConfigs(mockBillOptions);

    expect(configs[0].targetOptions).toBe(mockBillOptions.billVendorOptions);
    expect(configs[1].targetOptions).toBe(mockBillOptions.apAccountOptions);
    expect(configs[2].targetOptions).toBe(mockBillOptions.termsOptions);
  });

  it('buildJournalEntryColumnConfigs returns 4 configs with correct metadata', () => {
    const configs = buildJournalEntryColumnConfigs(mockJEOptions);

    expect(configs).toHaveLength(4);
    expect(configs.map((config) => config.sourceField)).toEqual(['account', 'name', 'class', 'tax']);
    expect(configs.map((config) => config.fieldType)).toEqual(['account', 'name', 'class', 'taxCode']);
    expect(configs.map((config) => config.label)).toEqual(['Account', 'Entity Name', 'Class', 'Tax Code']);
    expect(configs[0].targetOptions).toBe(mockJEOptions.jeAccountOptions);
    expect(configs[1].targetOptions).toBe(mockJEOptions.jeNameOptions);
    expect(configs[2].targetOptions).toBe(mockJEOptions.jeClassOptions);
    expect(configs[3].targetOptions).toBe(mockJEOptions.jeTaxOptions);
  });

  it('buildJournalEntryColumnConfigs assigns correct target options to each column', () => {
    const configs = buildJournalEntryColumnConfigs(mockJEOptions);

    expect(configs[0].targetOptions).toBe(mockJEOptions.jeAccountOptions);
    expect(configs[1].targetOptions).toBe(mockJEOptions.jeNameOptions);
    expect(configs[2].targetOptions).toBe(mockJEOptions.jeClassOptions);
    expect(configs[3].targetOptions).toBe(mockJEOptions.jeTaxOptions);
  });

  it('buildJournalEntryColumnConfigs class field maps to class fieldType', () => {
    const configs = buildJournalEntryColumnConfigs(mockJEOptions);

    expect(configs[2].sourceField).toBe('class');
    expect(configs[2].fieldType).toBe('class');
  });

  it('buildJournalEntryColumnConfigs tax field maps to taxCode fieldType', () => {
    const configs = buildJournalEntryColumnConfigs(mockJEOptions);

    expect(configs[3].sourceField).toBe('tax');
    expect(configs[3].fieldType).toBe('taxCode');
  });

  it('payee targets equal chequePayeeOptions', () => {
    const configs = buildChequeColumnConfigs(mockOptions);
    expect(configs[0].targetOptions).toBe(mockOptions.chequePayeeOptions);
  });

  it('bank account targets equal chequeBankOptions', () => {
    const configs = buildChequeColumnConfigs(mockOptions);
    expect(configs[1].targetOptions).toBe(mockOptions.chequeBankOptions);
  });

  it('category targets equal accountOptions', () => {
    const configs = buildChequeColumnConfigs(mockOptions);
    expect(configs[2].targetOptions).toBe(mockOptions.accountOptions);
  });

  it('tax type targets equal taxCodeOptions', () => {
    const configs = buildChequeColumnConfigs(mockOptions);
    expect(configs[3].targetOptions).toBe(mockOptions.taxCodeOptions);
  });

  it('bankAccount and category targets are different objects', () => {
    const configs = buildChequeColumnConfigs(mockOptions);
    expect(configs[1].targetOptions).not.toBe(configs[2].targetOptions);
  });

  it('buildValueMappingPayload includes custom matchingRule in both modes', () => {
    const formData: ValueMappingFormData = {
      fieldType: 'account',
      scannedText: 'Acme',
      entityId: 'acct-1',
      matchingRule: { type: 'EXACT', isActive: true },
    };
    const mockRule: MatchingRule = { type: 'CONTAINS', threshold: 0.5, isActive: true, direction: 'either' };
    const config: ColumnMappingConfig = {
      sourceField: 'payee',
      fieldType: 'name',
      label: 'Payee',
      description: 'desc',
      targetOptions: mockOptions.chequePayeeOptions,
    };

    const columnPayload = buildValueMappingPayload(formData, mockRule, config);
    expect(columnPayload.matchingRule).toBe(mockRule);

    const jePayload = buildValueMappingPayload(formData, mockRule);
    expect(jePayload.matchingRule).toBe(mockRule);
  });

  it('buildValueMappingPayload sends null when matchingRule is disabled', () => {
    const formData: ValueMappingFormData = {
      fieldType: 'account',
      scannedText: 'Acme',
      entityId: 'acct-1',
      matchingRule: { type: 'EXACT', isActive: true },
    };
    const config: ColumnMappingConfig = {
      sourceField: 'payee',
      fieldType: 'name',
      label: 'Payee',
      description: 'desc',
      targetOptions: mockOptions.chequePayeeOptions,
    };

    const columnPayload = buildValueMappingPayload(formData, null, config);
    expect(columnPayload.matchingRule).toBeNull();

    const jePayload = buildValueMappingPayload(formData, null);
    expect(jePayload.matchingRule).toBeNull();
  });

  it('filterMappingsForColumn isolates bankAccount from category by sourceField', () => {
    const mappings: ValueMapping[] = [
      { id: 'bank', templateId: 'template-1', fieldType: 'account', scannedText: 'A', sourceField: 'bankAccount', entityId: 'bank-1', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'category', templateId: 'template-1', fieldType: 'account', scannedText: 'A', sourceField: 'category', entityId: 'acct-1', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ];
    const configs = buildChequeColumnConfigs(mockOptions);

    const bankMappings = filterMappingsForColumn(mappings, configs[1]);
    const categoryMappings = filterMappingsForColumn(mappings, configs[2]);

    expect(bankMappings).toEqual([mappings[0]]);
    expect(categoryMappings).toEqual([mappings[1]]);
  });

  it('filterMappingsForColumn returns all mappings when no config is provided', () => {
    const mappings: ValueMapping[] = [
      { id: '1', templateId: 'template-1', fieldType: 'name', scannedText: 'A', sourceField: 'payee', entityId: 'vendor-1', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: '2', templateId: 'template-1', fieldType: 'account', scannedText: 'B', sourceField: 'bankAccount', entityId: 'bank-1', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ];

    expect(filterMappingsForColumn(mappings)).toEqual(mappings);
  });

  it('filterMappingsForColumn filters by sourceField and keeps account columns separate', () => {
    const mappings: ValueMapping[] = [
      { id: 'payee', templateId: 'template-1', fieldType: 'name', scannedText: 'A', sourceField: 'payee', entityId: 'vendor-1', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'bank', templateId: 'template-1', fieldType: 'account', scannedText: 'A', sourceField: 'bankAccount', entityId: 'bank-1', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'category', templateId: 'template-1', fieldType: 'account', scannedText: 'A', sourceField: 'category', entityId: 'acct-1', matchingRule: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ];
    const configs = buildChequeColumnConfigs(mockOptions);

    const payeeMappings = filterMappingsForColumn(mappings, configs[0]);
    const bankMappings = filterMappingsForColumn(mappings, configs[1]);
    const categoryMappings = filterMappingsForColumn(mappings, configs[2]);

    expect(payeeMappings).toEqual([mappings[0]]);
    expect(bankMappings).toEqual([mappings[1]]);
    expect(categoryMappings).toEqual([mappings[2]]);
  });

  it('getEffectiveFieldType uses config.fieldType when provided and formData.fieldType otherwise', () => {
    const config: ColumnMappingConfig = {
      sourceField: 'payee',
      fieldType: 'name',
      label: 'Payee',
      description: 'desc',
      targetOptions: mockOptions.chequePayeeOptions,
    };

    expect(getEffectiveFieldType({ fieldType: 'account' }, config)).toBe('name');
    expect(getEffectiveFieldType({ fieldType: 'account' })).toBe('account');
  });

  it('getEffectiveTargetOptions returns config options when config is provided and generic options otherwise', () => {
    const genericOptions = [{ value: 'generic', label: 'Generic' }];
    const config: ColumnMappingConfig = {
      sourceField: 'taxType',
      fieldType: 'taxCode',
      label: 'Tax Type',
      description: 'desc',
      targetOptions: mockOptions.taxCodeOptions,
    };

    expect(getEffectiveTargetOptions(genericOptions, config)).toBe(mockOptions.taxCodeOptions);
    expect(getEffectiveTargetOptions(genericOptions)).toBe(genericOptions);
  });

  it('buildValueMappingPayload includes sourceField and config.fieldType in column mode and omits sourceField in JE mode', () => {
    const formData: ValueMappingFormData = {
      fieldType: 'account',
      scannedText: ' Acme ',
      entityId: 'bank-1',
      matchingRule: { type: 'EXACT', isActive: true },
    };
    const config: ColumnMappingConfig = {
      sourceField: 'payee',
      fieldType: 'name',
      label: 'Payee',
      description: 'desc',
      targetOptions: mockOptions.chequePayeeOptions,
    };
    const rule: MatchingRule = { type: 'CONTAINS', threshold: 0.5, isActive: true, direction: 'either' };

    const columnPayload = buildValueMappingPayload(formData, rule, config);
    expect(columnPayload).toEqual({
      fieldType: 'name',
      scannedText: 'Acme',
      entityId: 'bank-1',
      sourceField: 'payee',
      matchingRule: rule,
    });

    const jePayload = buildValueMappingPayload(formData, null);
    expect(jePayload).toEqual({
      fieldType: 'account',
      scannedText: 'Acme',
      entityId: 'bank-1',
      matchingRule: null,
    });
    expect('sourceField' in jePayload).toBe(false);
  });

  it('buildValueMappingPayload uses provided matchingRule over formData.matchingRule', () => {
    const formData: ValueMappingFormData = {
      fieldType: 'account',
      scannedText: 'Acme',
      entityId: 'acct-1',
      matchingRule: { type: 'EXACT', isActive: true },
    };
    const payload = buildValueMappingPayload(formData, { type: 'STARTS_WITH', threshold: 0.7, isActive: true, direction: 'either' });

    expect(payload.matchingRule).toEqual({ type: 'STARTS_WITH', threshold: 0.7, isActive: true, direction: 'either' });
  });
});
