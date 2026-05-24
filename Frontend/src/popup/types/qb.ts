export interface QBAccount {
  Id: string;
  Name: string;
  FullyQualifiedName: string;
  AccountType: string;
  AccountSubType: string;
  Classification: string;
  Active: boolean;
  CurrentBalance?: number;
}

export interface QBClass {
  Id: string;
  Name: string;
  FullyQualifiedName: string;
  Active: boolean;
  SubClass: boolean;
  ParentRef?: { value: string; name: string };
}

export interface QBEmployee {
  Id: string;
  DisplayName: string;
  GivenName?: string;
  FamilyName?: string;
  Active: boolean;
  Status?: string;
}

export interface QBVendor {
  Id: string;
  DisplayName: string;
  CompanyName?: string;
  Active: boolean;
  Balance?: number;
}

export interface QBCustomer {
  Id: string;
  DisplayName: string;
  CompanyName?: string;
  Active: boolean;
  Balance?: number;
}

export interface QBTaxCode {
  Id: string;
  Name: string;
  Description?: string;
  Taxable: boolean;
  TaxGroup: boolean;
  Active: boolean;
  PurchaseTaxRateRef?: { value: string };
  SalesTaxRateRef?: { value: string };
}

export interface QBEntity {
  type: 'customer' | 'vendor' | 'employee';
  id: string;
  displayName: string;
}
