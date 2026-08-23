import type { ColumnMappingConfig, ValueMapping, ValueMappingFormData, MatchingRule } from '../../types';

interface ChequeColumnOptions {
  chequePayeeOptions: Array<{ value: string; label: string; subtitle?: string }>;
  chequeBankOptions: Array<{ value: string; label: string; subtitle?: string }>;
  accountOptions: Array<{ value: string; label: string; subtitle?: string }>;
  taxCodeOptions: Array<{ value: string; label: string; subtitle?: string }>;
}

interface BillColumnOptions {
  billVendorOptions: Array<{ value: string; label: string; subtitle?: string }>;
  apAccountOptions: Array<{ value: string; label: string; subtitle?: string }>;
  termsOptions: Array<{ value: string; label: string; subtitle?: string }>;
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

interface BillColumnOptions {
  billVendorOptions: Array<{ value: string; label: string; subtitle?: string }>;
  apAccountOptions: Array<{ value: string; label: string; subtitle?: string }>;
  termsOptions: Array<{ value: string; label: string; subtitle?: string }>;
}

export function buildBillColumnConfigs(options: BillColumnOptions): ColumnMappingConfig[] {
  return [
    {
      sourceField: 'vendorRef',
      fieldType: 'name',
      label: 'Vendor',
      description: 'Map raw vendor names from your Excel to QuickBooks vendors',
      targetOptions: options.billVendorOptions,
    },
    {
      sourceField: 'apAccountRef',
      fieldType: 'account',
      label: 'AP Account',
      description: 'Map raw AP account names from your Excel to QuickBooks accounts',
      targetOptions: options.apAccountOptions,
    },
    {
      sourceField: 'termsRef',
      fieldType: 'name',
      label: 'Terms',
      description: 'Map terms text from your Excel to QuickBooks terms',
      targetOptions: options.termsOptions,
    },
  ];
}

interface JournalEntryColumnOptions {
  jeAccountOptions: Array<{ value: string; label: string; subtitle?: string }>;
  jeNameOptions: Array<{ value: string; label: string; subtitle?: string }>;
  jeClassOptions: Array<{ value: string; label: string; subtitle?: string }>;
  jeTaxOptions: Array<{ value: string; label: string; subtitle?: string }>;
}

export function buildJournalEntryColumnConfigs(options: JournalEntryColumnOptions): ColumnMappingConfig[] {
  return [
    {
      sourceField: 'account',
      fieldType: 'account',
      label: 'Account',
      description: 'Map raw account names from Excel to QuickBooks accounts',
      targetOptions: options.jeAccountOptions,
    },
    {
      sourceField: 'name',
      fieldType: 'name',
      label: 'Entity Name',
      description: 'Map raw entity/customer names from Excel to QuickBooks vendors/customers',
      targetOptions: options.jeNameOptions,
    },
    {
      sourceField: 'class',
      fieldType: 'class',
      label: 'Class',
      description: 'Map raw class names from Excel to QuickBooks classes',
      targetOptions: options.jeClassOptions,
    },
    {
      sourceField: 'tax',
      fieldType: 'taxCode',
      label: 'Tax Code',
      description: 'Map raw tax names from Excel to QuickBooks tax codes',
      targetOptions: options.jeTaxOptions,
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
