import { CreateBillInput, CreateBillPaymentInput, CreateChequeInput, CreateJournalEntryInput, CreateVendorCreditInput, ChequeResponse, JournalEntryResponse, OutstandingBill, VendorCreditItem, BillPaymentResponse, QBJournalLineItem, QBBillLineItem } from '../types';
import { QBApiError } from '../lib/qb-errors';
import { prisma } from '../lib/prisma';
import { encrypt, decryptSafe } from '../lib/encryption';

const QB_CLIENT_ID = process.env.QB_CLIENT_ID;
const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET;
if (!QB_CLIENT_ID || !QB_CLIENT_SECRET) {
  throw new Error('QB_CLIENT_ID and QB_CLIENT_SECRET environment variables are required');
}

const QB_API_BASE_URL = process.env.QB_API_BASE_URL ?? 'https://quickbooks.api.intuit.com/v3/company';

// ── Internal QB response types ────────────────────────────────────────────────
interface QBAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
  Classification?: string;
  FullyQualifiedName: string;
  Active: boolean;
}

interface QBClass {
  Id: string;
  Name: string;
  FullyQualifiedName: string;
  Active: boolean;
}

interface QBEmployee {
  Id: string;
  DisplayName: string;
  Active: boolean;
}

interface QBVendor {
  Id: string;
  DisplayName: string;
  Active: boolean;
}

interface QBCustomer {
  Id: string;
  DisplayName: string;
  Active: boolean;
}

interface QBTaxCode {
  Id: string;
  Name: string;
  Description?: string;
  Active: boolean;
}

// ── Generic QB query helper ───────────────────────────────────────────────────
async function qbQuery<T>(realmId: string, accessToken: string, query: string): Promise<T> {
  const url = `${QB_API_BASE_URL}/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=75`;
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[QB Service] QUERY ${url}`);
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const text = await response.text();
    const intuitTid = response.headers.get('intuit_tid') ?? undefined;
    throw new QBApiError(`QB query failed (${response.status}): ${text}`, response.status, undefined, intuitTid);
  }
  return response.json() as Promise<T>;
}

// ── Entity query functions ────────────────────────────────────────────────────
async function getAccounts(realmId: string, accessToken: string): Promise<QBAccount[]> {
  const data = await qbQuery<{ QueryResponse: { Account?: QBAccount[] } }>(
    realmId, accessToken,
    'SELECT * FROM Account WHERE Active = true MAXRESULTS 1000',
  );
  return data.QueryResponse.Account ?? [];
}

async function getClasses(realmId: string, accessToken: string): Promise<QBClass[]> {
  const data = await qbQuery<{ QueryResponse: { Class?: QBClass[] } }>(
    realmId, accessToken,
    'SELECT * FROM Class WHERE Active = true MAXRESULTS 1000',
  );
  return data.QueryResponse.Class ?? [];
}

async function getEmployees(realmId: string, accessToken: string): Promise<QBEmployee[]> {
  const data = await qbQuery<{ QueryResponse: { Employee?: QBEmployee[] } }>(
    realmId, accessToken,
    'SELECT * FROM Employee WHERE Active = true MAXRESULTS 1000',
  );
  return data.QueryResponse.Employee ?? [];
}

async function getVendors(realmId: string, accessToken: string): Promise<QBVendor[]> {
  const data = await qbQuery<{ QueryResponse: { Vendor?: QBVendor[] } }>(
    realmId, accessToken,
    'SELECT * FROM Vendor WHERE Active = true MAXRESULTS 1000',
  );
  return data.QueryResponse.Vendor ?? [];
}

async function getCustomers(realmId: string, accessToken: string): Promise<QBCustomer[]> {
  const data = await qbQuery<{ QueryResponse: { Customer?: QBCustomer[] } }>(
    realmId, accessToken,
    'SELECT * FROM Customer WHERE Active = true MAXRESULTS 1000',
  );
  return data.QueryResponse.Customer ?? [];
}

interface QBTerm {
  Id: string;
  Name: string;
  Type?: 'Standard' | 'DateDriven';
  DueDays?: number;
  DayOfMonth?: number;
  Month?: number;
  DueNextMonthDays?: number;
  Active?: boolean;
}

async function getTaxCodes(realmId: string, accessToken: string): Promise<QBTaxCode[]> {
  const data = await qbQuery<{ QueryResponse: { TaxCode?: QBTaxCode[] } }>(
    realmId, accessToken,
    'SELECT * FROM TaxCode MAXRESULTS 1000',
  );
  return data.QueryResponse.TaxCode ?? [];
}

async function getTerms(realmId: string, accessToken: string): Promise<QBTerm[]> {
  const data = await qbQuery<{ QueryResponse: { Term?: QBTerm[] } }>(
    realmId, accessToken,
    'SELECT * FROM Term WHERE Active = true ORDER BY Name ASC MAXRESULTS 1000',
  );
  return data.QueryResponse.Term ?? [];
}

async function getOutstandingBills(realmId: string, accessToken: string): Promise<OutstandingBill[]> {
  const query = "SELECT Id, TxnDate, DueDate, TotalAmt, Balance, VendorRef, DocNumber FROM Bill WHERE Balance > 0 ORDERBY TxnDate ASC MAXRESULTS 1000";
  const result = await qbQuery<{ Bill: Record<string, unknown>[] | Record<string, unknown> }>(realmId, accessToken, query);
  const raw = Array.isArray(result.Bill) ? result.Bill : result.Bill ? [result.Bill] : [];
  return raw.map((b) => ({
    id: b.Id as string,
    txnDate: b.TxnDate as string,
    dueDate: b.DueDate as string | undefined,
    totalAmt: b.TotalAmt as number,
    balance: b.Balance as number,
    vendorRef: b.VendorRef as { value: string; name?: string },
    docNumber: b.DocNumber as string | undefined,
  }));
}

async function getVendorCredits(realmId: string, accessToken: string): Promise<VendorCreditItem[]> {
  const query = "SELECT Id, TxnDate, TotalAmt, Balance, VendorRef, DocNumber FROM VendorCredit WHERE Balance > 0 ORDERBY TxnDate ASC MAXRESULTS 1000";
  const result = await qbQuery<{ VendorCredit: Record<string, unknown>[] | Record<string, unknown> }>(realmId, accessToken, query);
  const raw = Array.isArray(result.VendorCredit) ? result.VendorCredit : result.VendorCredit ? [result.VendorCredit] : [];
  return raw.map((vc) => ({
    id: vc.Id as string,
    txnDate: vc.TxnDate as string,
    totalAmt: vc.TotalAmt as number,
    balance: vc.Balance as number,
    vendorRef: vc.VendorRef as { value: string; name?: string },
    docNumber: vc.DocNumber as string | undefined,
  }));
}

function buildBillPaymentPayload(input: CreateBillPaymentInput): object {
  const { vendorRef, payType, bankAccountRef, checkNum, txnDate, totalAmt, lines } = input;

  const payload: Record<string, unknown> = {
    VendorRef: vendorRef,
    TxnDate: txnDate,
    TotalAmt: totalAmt,
    Line: lines.map((line) => ({
      Amount: line.amount,
      LinkedTxn: {
        TxnId: line.linkedTxn.txnId,
        TxnType: line.linkedTxn.txnType,
      },
    })),
  };

  if (payType === 'Check') {
    payload.PayType = 'Check';
    const checkPayment: Record<string, unknown> = {};
    if (bankAccountRef) checkPayment.BankAccountRef = bankAccountRef;
    if (checkNum) checkPayment.CheckNum = checkNum;
    payload.CheckPayment = checkPayment;
  } else if (payType === 'Cash') {
    payload.PayType = 'Cash';
  } else if (payType === 'CreditCard') {
    payload.PayType = 'CreditCard';
    const ccPayment: Record<string, unknown> = {};
    if (bankAccountRef) ccPayment.CCCardAccountRef = bankAccountRef;
    payload.CreditCardPayment = ccPayment;
  } else {
    payload.PayType = 'Other';
  }

  return payload;
}

async function createBillPayment(input: CreateBillPaymentInput): Promise<BillPaymentResponse> {
  const { realmId, accessToken } = input;
  const payload = buildBillPaymentPayload(input);
  const url = `${QB_API_BASE_URL}/${realmId}/billpayment?minorversion=65`;

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[QB Service] POST ${url}`);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const fault = responseBody.Fault as Record<string, unknown> | undefined;
    const faultErrors = fault?.Error as Array<Record<string, unknown>> | undefined;
    const intuitTid = response.headers.get('intuit_tid') ?? undefined;
    const errMsg = faultErrors?.[0]?.Message as string | undefined ?? JSON.stringify(fault ?? responseBody);
    const errCode = faultErrors?.[0]?.code as string | undefined;
    throw new QBApiError(`QB bill payment failed (${response.status}): ${errMsg}`, response.status, errCode, intuitTid);
  }

  const billPayment = responseBody.BillPayment as Record<string, unknown>;

  return {
    id: billPayment.Id as string,
    txnDate: billPayment.TxnDate as string,
    totalAmt: billPayment.TotalAmt as number,
    syncToken: billPayment.SyncToken as string,
  };
}

/**
 * Build the QuickBooks JournalEntry payload per the QB API spec.
 * Validates that total debits === total credits (required by QB).
 */
function buildJournalEntryPayload(input: CreateJournalEntryInput): object {
  const { txnDate, docNumber, lines, privateNote } = input;

  let totalDebits = 0;
  let totalCredits = 0;

  const qbLines = lines.map((line: QBJournalLineItem) => {
    if (line.postingType === 'Debit') totalDebits += line.amount;
    else totalCredits += line.amount;

    const lineDetail: Record<string, unknown> = {
      PostingType: line.postingType,
      AccountRef: line.accountRef,
    };

    if (line.classRef) lineDetail.ClassRef = line.classRef;
    if (line.departmentRef) lineDetail.DepartmentRef = line.departmentRef;
    if (line.entityRef) lineDetail.Entity = { EntityRef: { value: line.entityRef.value, name: line.entityRef.name }, Type: line.entityRef.type ?? 'Customer' };

    const qbLine: Record<string, unknown> = {
      Amount: line.amount,
      DetailType: 'JournalEntryLineDetail',
      JournalEntryLineDetail: lineDetail,
    };

    if (line.description) qbLine.Description = line.description;

    return qbLine;
  });

  // QB requires debits === credits
  const roundedDebits = Math.round(totalDebits * 100) / 100;
  const roundedCredits = Math.round(totalCredits * 100) / 100;

  if (roundedDebits !== roundedCredits) {
    throw new Error(
      `Journal Entry is unbalanced: total debits (${roundedDebits}) !== total credits (${roundedCredits})`
    );
  }

  const payload: Record<string, unknown> = {
    TxnDate: txnDate,
    Line: qbLines,
  };

  if (docNumber) payload.DocNumber = docNumber;
  if (privateNote) payload.PrivateNote = privateNote;

  if (process.env.NODE_ENV !== 'production') {
    console.log('[QB Service] Journal Entry payload:');
    console.log(JSON.stringify(payload, null, 2));
  }

  return payload;
}

/**
 * Create a Journal Entry in QuickBooks Online.
 * Uses raw fetch — no QB SDK dependency.
 */
async function createJournalEntry(input: CreateJournalEntryInput): Promise<JournalEntryResponse> {
  const { realmId, accessToken } = input;

  const payload = buildJournalEntryPayload(input);

  const url = `${QB_API_BASE_URL}/${realmId}/journalentry?minorversion=65`;

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[QB Service] POST ${url}`);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const fault = responseBody.Fault as Record<string, unknown> | undefined;
    const faultErrors = fault?.Error as Array<Record<string, unknown>> | undefined;
    const intuitTid = response.headers.get('intuit_tid') ?? undefined;
    const errMsg = faultErrors?.[0]?.Message as string | undefined ?? JSON.stringify(fault ?? responseBody);
    const errCode = faultErrors?.[0]?.code as string | undefined;
    throw new QBApiError(`QB journal entry failed (${response.status}): ${errMsg}`, response.status, errCode, intuitTid);
  }

  const je = responseBody.JournalEntry as Record<string, unknown>;

  return {
    id: je.Id as string,
    txnDate: je.TxnDate as string,
    totalAmount: je.TotalAmt as number,
    syncToken: je.SyncToken as string,
  };
}

function buildBillPayload(input: CreateBillInput): object {
  const { txnDate, docNumber, vendorRef, apAccountRef, termsRef, dueDate, memo, lines } = input;

  const qbLines = lines.map((line: QBBillLineItem) => {
    const lineDetail: Record<string, unknown> = {
      AccountRef: line.accountRef,
    };

    if (line.classRef) lineDetail.ClassRef = line.classRef;
    if (line.taxCodeRef) lineDetail.TaxCodeRef = line.taxCodeRef;

    const qbLine: Record<string, unknown> = {
      Amount: line.amount,
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: lineDetail,
    };

    if (line.description) qbLine.Description = line.description;

    return qbLine;
  });

  const payload: Record<string, unknown> = {
    TxnDate: txnDate,
    VendorRef: vendorRef,
    APAccountRef: apAccountRef,
    Line: qbLines,
  };

  if (docNumber) payload.DocNumber = docNumber;
  if (termsRef) payload.TermsRef = termsRef;
  if (dueDate) payload.DueDate = dueDate;
  if (memo) payload.PrivateNote = memo;

  if (process.env.NODE_ENV !== 'production') {
    console.log('[QB Service] Bill payload:');
    console.log(JSON.stringify(payload, null, 2));
  }

  return payload;
}

async function createBill(input: CreateBillInput): Promise<JournalEntryResponse> {
  const { realmId, accessToken } = input;
  const payload = buildBillPayload(input);
  const url = `${QB_API_BASE_URL}/${realmId}/bill?minorversion=65`;

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[QB Service] POST ${url}`);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const fault = responseBody.Fault as Record<string, unknown> | undefined;
    const faultErrors = fault?.Error as Array<Record<string, unknown>> | undefined;
    const intuitTid = response.headers.get('intuit_tid') ?? undefined;
    const errMsg = faultErrors?.[0]?.Message as string | undefined ?? JSON.stringify(fault ?? responseBody);
    const errCode = faultErrors?.[0]?.code as string | undefined;
    throw new QBApiError(`QB bill failed (${response.status}): ${errMsg}`, response.status, errCode, intuitTid);
  }

  const bill = responseBody.Bill as Record<string, unknown>;

  return {
    id: bill.Id as string,
    txnDate: bill.TxnDate as string,
    totalAmount: bill.TotalAmt as number,
    syncToken: bill.SyncToken as string,
  };
}

function buildVendorCreditPayload(input: CreateVendorCreditInput): object {
  const { txnDate, docNumber, vendorRef, apAccountRef, memo, lines } = input;

  const qbLines = lines.map((line: QBBillLineItem) => {
    const lineDetail: Record<string, unknown> = {
      AccountRef: line.accountRef,
    };

    if (line.classRef) lineDetail.ClassRef = line.classRef;
    if (line.taxCodeRef) lineDetail.TaxCodeRef = line.taxCodeRef;

    const qbLine: Record<string, unknown> = {
      Amount: line.amount,
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: lineDetail,
    };

    if (line.description) qbLine.Description = line.description;

    return qbLine;
  });

  const payload: Record<string, unknown> = {
    TxnDate: txnDate,
    VendorRef: vendorRef,
    APAccountRef: apAccountRef,
    Line: qbLines,
  };

  if (docNumber) payload.DocNumber = docNumber;
  if (memo) payload.PrivateNote = memo;

  if (process.env.NODE_ENV !== 'production') {
    console.log('[QB Service] Vendor Credit payload:');
    console.log(JSON.stringify(payload, null, 2));
  }

  return payload;
}

function buildChequePayload(input: CreateChequeInput): object {
  const lines = input.lines.map((line) => {
    const lineDetail: Record<string, unknown> = {
      AccountRef: {
        value: line.accountRef.value,
        ...(line.accountRef.name && { name: line.accountRef.name }),
      },
    };

    if (line.classRef?.value) {
      lineDetail.ClassRef = {
        value: line.classRef.value,
        ...(line.classRef.name && { name: line.classRef.name }),
      };
    }

    const qbLine: Record<string, unknown> = {
      Amount: line.amount,
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: lineDetail,
    };

    if (line.description) qbLine.Description = line.description;
    return qbLine;
  });

  const payload: Record<string, unknown> = {
    PaymentType: 'Check',
    AccountRef: {
      value: input.bankAccountRef.value,
      ...(input.bankAccountRef.name && { name: input.bankAccountRef.name }),
    },
    PayeeEntityRef: {
      value: input.payeeRef.value,
      ...(input.payeeRef.name && { name: input.payeeRef.name }),
    },
    TxnDate: input.txnDate,
    TotalAmt: input.amount,
    Line: lines,
    PrintStatus: 'NeedToPrint',
  };

  if (input.memo) payload.Memo = input.memo;
  if (input.docNumber) payload.DocNumber = input.docNumber;

  return payload;
}

async function createCheque(input: CreateChequeInput): Promise<ChequeResponse> {
  const { realmId, accessToken } = input;
  const payload = buildChequePayload(input);
  const url = `${QB_API_BASE_URL}/${realmId}/purchase?minorversion=65`;

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[QB Service] POST ${url}`);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const fault = responseBody.Fault as Record<string, unknown> | undefined;
    const faultErrors = fault?.Error as Array<Record<string, unknown>> | undefined;
    const intuitTid = response.headers.get('intuit_tid') ?? undefined;
    const errMsg = faultErrors?.[0]?.Message as string | undefined ?? JSON.stringify(fault ?? responseBody);
    const errCode = faultErrors?.[0]?.code as string | undefined;
    throw new QBApiError(`QB purchase (cheque) failed (${response.status}): ${errMsg}`, response.status, errCode, intuitTid);
  }

  const purchase = responseBody.Purchase as Record<string, unknown>;

  return {
    id: purchase.Id as string,
    txnDate: purchase.TxnDate as string,
    totalAmt: purchase.TotalAmt as number,
    docNumber: purchase.DocNumber as string,
    syncToken: purchase.SyncToken as string,
  };
}

async function createVendorCredit(input: CreateVendorCreditInput): Promise<JournalEntryResponse> {
  const { realmId, accessToken } = input;
  const payload = buildVendorCreditPayload(input);
  const url = `${QB_API_BASE_URL}/${realmId}/vendorcredit?minorversion=65`;

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[QB Service] POST ${url}`);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const fault = responseBody.Fault as Record<string, unknown> | undefined;
    const faultErrors = fault?.Error as Array<Record<string, unknown>> | undefined;
    const intuitTid = response.headers.get('intuit_tid') ?? undefined;
    const errMsg = faultErrors?.[0]?.Message as string | undefined ?? JSON.stringify(fault ?? responseBody);
    const errCode = faultErrors?.[0]?.code as string | undefined;
    throw new QBApiError(`QB vendor credit failed (${response.status}): ${errMsg}`, response.status, errCode, intuitTid);
  }

  const vendorCredit = responseBody.VendorCredit as Record<string, unknown>;

  return {
    id: vendorCredit.Id as string,
    txnDate: vendorCredit.TxnDate as string,
    totalAmount: vendorCredit.TotalAmt as number,
    syncToken: vendorCredit.SyncToken as string,
  };
}

/**
 * Refresh the QB access token using the refresh token.
 */
async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const QB_TOKEN_URL = process.env.QB_TOKEN_URL ?? 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

  const credentials = Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${text}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

async function getValidToken(userId: string): Promise<{ accessToken: string; realmId: string }> {
  const qbToken = await prisma.qBToken.findUnique({ where: { userId } });
  if (!qbToken) {
    throw new QBApiError('QuickBooks not connected. Please complete OAuth first.', 401);
  }

  if (qbToken.expiresAt < new Date()) {
    const refreshToken = decryptSafe(qbToken.refreshToken);
    try {
      const refreshed = await refreshAccessToken(refreshToken);
      await prisma.qBToken.update({
        where: { userId },
        data: {
          accessToken: encrypt(refreshed.accessToken),
          refreshToken: encrypt(refreshed.refreshToken),
          expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
          stale: false,
        },
      });
      return { accessToken: refreshed.accessToken, realmId: qbToken.realmId };
    } catch (refreshError) {
      await prisma.qBToken.update({ where: { userId }, data: { stale: true } }).catch(() => {});
      throw refreshError;
    }
  }

  return { accessToken: decryptSafe(qbToken.accessToken), realmId: qbToken.realmId };
}

async function forceRefreshToken(userId: string): Promise<string> {
  const tokenRow = await prisma.qBToken.findUnique({ where: { userId } });
  if (!tokenRow) {
    throw new QBApiError('No QB token found', 401);
  }
  if (tokenRow.stale) {
    throw new QBApiError('QB token is stale — reconnect required', 401);
  }

  const decryptedRefresh = decryptSafe(tokenRow.refreshToken);
  const result = await refreshAccessToken(decryptedRefresh);

  await prisma.qBToken.update({
    where: { userId },
    data: {
      accessToken: encrypt(result.accessToken),
      refreshToken: encrypt(result.refreshToken),
      expiresAt: new Date(Date.now() + result.expiresIn * 1000),
      stale: false,
    },
  });

  return result.accessToken;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callQB<T>(userId: string, fn: (creds: { accessToken: string; realmId: string }) => Promise<T>): Promise<T> {
  let { accessToken, realmId } = await getValidToken(userId);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn({ accessToken, realmId });
    } catch (err: unknown) {
      if (!(err instanceof QBApiError)) throw err;
      if (err.statusCode === 401 && attempt === 0) {
        accessToken = await forceRefreshToken(userId);
        continue;
      }
      if (err.statusCode === 429 && attempt < 2) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }

  throw new QBApiError('Max QB retry attempts exceeded', 429);
}

async function revokeAccessToken(accessToken: string): Promise<void> {
  await fetch('https://developer.api.intuit.com/v2/oauth2/tokens/revoke', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ token: accessToken }),
  });
}

export const qbService = {
  createJournalEntry,
  createBill,
  createVendorCredit,
  createCheque,
  createBillPayment,
  refreshAccessToken,
  buildJournalEntryPayload,
  buildBillPayload,
  buildVendorCreditPayload,
  buildChequePayload,
  buildBillPaymentPayload,
  getOutstandingBills,
  getVendorCredits,
  getAccounts,
  getClasses,
  getEmployees,
  getVendors,
  getCustomers,
  getTaxCodes,
  getTerms,
  callQB,
  revokeAccessToken,
};
