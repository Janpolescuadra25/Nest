// QB API entity types — field names match QuickBooks API PascalCase format

export interface QBAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
  Classification?: string;
  FullyQualifiedName: string;
  Active: boolean;
}

export interface QBClass {
  Id: string;
  Name: string;
  FullyQualifiedName: string;
  Active: boolean;
}

export interface QBEmployee {
  Id: string;
  DisplayName: string;
  Active: boolean;
}

export interface QBVendor {
  Id: string;
  DisplayName: string;
  Active: boolean;
}

export interface QBCustomer {
  Id: string;
  DisplayName: string;
  Active: boolean;
}

export interface QBTaxCode {
  Id: string;
  Name: string;
  Description?: string;
  Active: boolean;
}

export interface QBEntity {
  type: 'customer' | 'vendor' | 'employee';
  id: string;
  displayName: string;
}
