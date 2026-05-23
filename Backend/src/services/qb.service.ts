import { CreateJournalEntryInput, JournalEntryResponse, QBJournalLineItem } from '../types';

const QB_API_BASE_URL = process.env.QB_API_BASE_URL ?? 'https://sandbox-quickbooks.api.intuit.com/v3/company';

/**
 * Build the QuickBooks JournalEntry payload per the QB API spec.
 * Validates that total debits === total credits (required by QB).
 */
function buildJournalEntryPayload(input: CreateJournalEntryInput): object {
  const { txnDate, lines, privateNote } = input;

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
    if (line.entityRef) lineDetail.Entity = { EntityRef: line.entityRef, Type: line.entityRef.type ?? 'Customer' };

    const qbLine: Record<string, unknown> = {
      Amount: line.amount,
      DetailType: 'JournalEntryLineDetail',
      JournalEntryLineDetail: lineDetail,
    };

    if (line.description) qbLine.Description = line.description;
    if (line.memo) qbLine.LineNum = undefined; // memo is set on the transaction, not the line

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

  if (privateNote) payload.PrivateNote = privateNote;

  console.log('[QB Service] Journal Entry payload:');
  console.log(JSON.stringify({ JournalEntry: payload }, null, 2));

  return { JournalEntry: payload };
}

/**
 * Create a Journal Entry in QuickBooks Online.
 * Uses raw fetch — no QB SDK dependency.
 */
async function createJournalEntry(input: CreateJournalEntryInput): Promise<JournalEntryResponse> {
  const { realmId, accessToken } = input;

  const payload = buildJournalEntryPayload(input);

  const url = `${QB_API_BASE_URL}/${realmId}/journalentry`;

  console.log(`[QB Service] POST ${url}`);

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
    const errMsg = fault ? JSON.stringify(fault) : `QB API error ${response.status}`;
    throw new Error(errMsg);
  }

  const je = responseBody.JournalEntry as Record<string, unknown>;

  return {
    id: je.Id as string,
    txnDate: je.TxnDate as string,
    totalAmount: je.TotalAmt as number,
    syncToken: je.SyncToken as string,
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
  const QB_CLIENT_ID = process.env.QB_CLIENT_ID ?? '';
  const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET ?? '';
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

export const qbService = { createJournalEntry, refreshAccessToken, buildJournalEntryPayload };
