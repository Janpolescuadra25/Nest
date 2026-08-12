import type { ColumnMappingConfig, ValueMapping, ValueMappingFormData, MatchingRule } from '../../types';

interface ChequeColumnOptions {
  chequePayeeOptions: Array<{ value: string; label: string; subtitle?: string }>;
  chequeBankOptions: Array<{ value: string; label: string; subtitle?: string }>;
  accountOptions: Array<{ value: string; label: string; subtitle?: string }>;
  taxCodeOptions: Array<{ value: string; label: string; subtitle?: string }>;
}

export function buildChequeColumnConfigs(options: ChequeColumnOptions): ColumnMappingConfig[] {
  return [
    {
      sourceField: 'payee',
      fieldType: 'name',
      label: 'Payee',
      description: 'Map raw payee names from your Excel to QuickBooks vendors',
      targetOptions: options.chequePayeeOptions,
    },
    {
      sourceField: 'bankAccount',
      fieldType: 'account',
      label: 'Bank Account',
      description: 'Map bank account names to QuickBooks Bank-type accounts',
      targetOptions: options.chequeBankOptions,
    },
    {
      sourceField: 'category',
      fieldType: 'account',
      label: 'Category',
      description: 'Map category names to QuickBooks accounts',
      targetOptions: options.accountOptions,
    },
    {
      sourceField: 'taxType',
      fieldType: 'taxCode',
      label: 'Tax Type',
      description: 'Map tax type text to QuickBooks tax codes',
      targetOptions: options.taxCodeOptions,
    },
  ];
}

export function filterMappingsForColumn(
  mappings: ValueMapping[],
  columnConfig?: ColumnMappingConfig,
): ValueMapping[] {
  if (!columnConfig) {
    return mappings;
  }

  return mappings.filter((mapping) => mapping.sourceField === columnConfig.sourceField);
}

export function getEffectiveFieldType(
  formData: { fieldType: string },
  columnConfig?: ColumnMappingConfig,
): ValueMapping['fieldType'] {
  return columnConfig ? columnConfig.fieldType : (formData.fieldType as ValueMapping['fieldType']);
}

export function getEffectiveTargetOptions(
  genericOptions: Array<{ value: string; label: string; subtitle?: string }>,
  columnConfig?: ColumnMappingConfig,
): Array<{ value: string; label: string; subtitle?: string }> {
  return columnConfig ? columnConfig.targetOptions : genericOptions;
}

export function buildValueMappingPayload(
  formData: ValueMappingFormData,
  matchingRule: MatchingRule | null,
  columnConfig?: ColumnMappingConfig,
): {
  fieldType: ValueMapping['fieldType'];
  scannedText: string;
  entityId: string;
  sourceField?: string | null;
  matchingRule: MatchingRule | null;
} {
  const payload: {
    fieldType: ValueMapping['fieldType'];
    scannedText: string;
    entityId: string;
    sourceField?: string | null;
    matchingRule: MatchingRule | null;
  } = {
    fieldType: columnConfig ? columnConfig.fieldType : formData.fieldType,
    scannedText: formData.scannedText.trim(),
    entityId: formData.entityId,
    matchingRule,
  };

  if (columnConfig) {
    payload.sourceField = columnConfig.sourceField;
  }

  return payload;
}
