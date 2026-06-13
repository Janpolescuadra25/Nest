import { GoogleGenerativeAI, ArraySchema, ObjectSchema, SchemaType } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const invoiceSchema: ObjectSchema = {
  type: SchemaType.OBJECT,
  properties: {
    vendor: { type: SchemaType.STRING, description: 'Vendor/supplier company name from the invoice' },
    invoiceNumber: { type: SchemaType.STRING, description: 'Invoice number or reference number' },
    invoiceDate: { type: SchemaType.STRING, description: 'Invoice date in YYYY-MM-DD format, or the raw date string if unparseable' },
    dueDate: { type: SchemaType.STRING, description: 'Payment due date in YYYY-MM-DD format, or the raw date string if unparseable, or empty string if not found' },
    total: { type: SchemaType.STRING, description: 'Grand total amount as a string (e.g. "1234.56"), digits and decimal only' },
    lineItems: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          description: { type: SchemaType.STRING, description: 'Item description or name' },
          quantity: { type: SchemaType.STRING, description: 'Quantity ordered' },
          unitPrice: { type: SchemaType.STRING, description: 'Unit price as a string (e.g. "12.99")' },
          total: { type: SchemaType.STRING, description: 'Line total amount as a string (e.g. "25.98")' },
        },
        required: ['description', 'quantity', 'unitPrice', 'total'],
      },
    },
  },
  required: ['vendor', 'invoiceNumber', 'invoiceDate', 'dueDate', 'total', 'lineItems'],
};

type DocumentType = 'INVOICE' | 'CHEQUE' | 'POS_REPORT' | 'RECEIPT' | 'OTHER';

export interface DocumentClassification {
  documentType: DocumentType;
  confidence: number;
  reasoning: string;
}

export type InvoiceHeader = {
  vendor: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  total: string;
};

export type InvoiceLineItem = {
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
};

export type ChequeData = {
  chequeNumber: string;
  payeeName: string;
  amount: string;
  date: string;
  memo: string;
  bankName: string;
  lineItems: ChequeLineItem[];
};

export type ChequeLineItem = {
  description: string;
  amount: string;
};

export interface ParseDocumentResult {
  classification: DocumentClassification;
  invoiceData: { header: InvoiceHeader; lineItems: InvoiceLineItem[] } | null;
  chequeData: ChequeData | null;
}

const classificationSchema: ObjectSchema = {
  type: SchemaType.OBJECT,
  properties: {
    documentType: { type: SchemaType.STRING, description: 'Document type, must be one of: INVOICE, CHEQUE, POS_REPORT, RECEIPT, OTHER' },
    confidence: { type: SchemaType.NUMBER, description: 'Confidence score from 0 to 1' },
    reasoning: { type: SchemaType.STRING, description: 'Brief explanation of why this document type was chosen' },
  },
  required: ['documentType', 'confidence', 'reasoning'],
};

const chequeSchema: ObjectSchema = {
  type: SchemaType.OBJECT,
  properties: {
    chequeNumber: { type: SchemaType.STRING, description: 'Cheque or check number printed on the cheque' },
    payeeName: { type: SchemaType.STRING, description: 'Name of the payee the cheque is written to' },
    amount: { type: SchemaType.STRING, description: 'Total amount of the cheque as a string' },
    date: { type: SchemaType.STRING, description: 'Date on the cheque in YYYY-MM-DD format if possible' },
    memo: { type: SchemaType.STRING, description: 'Memo or notes written on the cheque' },
    bankName: { type: SchemaType.STRING, description: 'Name of the bank the cheque is drawn from' },
    lineItems: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          description: { type: SchemaType.STRING, description: 'Description of what the cheque is for' },
          amount: { type: SchemaType.STRING, description: 'Line item amount as a string' },
        },
        required: ['description', 'amount'],
      },
      description: 'Line items describing the cheque purpose (typically one item for the full amount)',
    },
  },
  required: ['chequeNumber', 'payeeName', 'amount', 'date', 'memo', 'bankName', 'lineItems'],
};

export async function classifyDocument(
  imageBuffer: Buffer,
  mimeType: string
): Promise<DocumentClassification> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: classificationSchema,
    },
    systemInstruction: `You are an expert document classifier for restaurant automation. Identify the document type for the image provided. The categories are:
- INVOICE: Vendor bill with line items, amounts, vendor info, due dates.
- CHEQUE: Bank cheque or check with payee, amount, date, cheque number, memo.
- POS_REPORT: Point-of-sale sales summary/report with sales categories, totals, payment breakdowns.
- RECEIPT: Purchase receipt (similar to invoice but typically simpler, from a retail transaction).
- OTHER: Anything that does not fit the above categories.
Return only valid JSON that matches the schema. Do not include any extra commentary.`,
  });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: imageBuffer.toString('base64'),
      },
    },
  ]);

  const text = result.response.text();
  const parsed = JSON.parse(text);

  const documentType = String(parsed.documentType || 'OTHER').toUpperCase() as DocumentType;
  return {
    documentType: ['INVOICE', 'CHEQUE', 'POS_REPORT', 'RECEIPT', 'OTHER'].includes(documentType)
      ? documentType
      : 'OTHER',
    confidence: Number(parsed.confidence) || 0,
    reasoning: String(parsed.reasoning || ''),
  };
}

export async function parseChequeWithGemini(
  imageBuffer: Buffer,
  mimeType: string
): Promise<ChequeData> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: chequeSchema,
    },
    systemInstruction: `You are an expert cheque data extractor. Extract structured information from a bank cheque image.
RULES:
- Identify the payee name, cheque number (usually top right), date, amount (both numeric and words if present), memo line, and bank name.
- Cheque images typically include a bank name, payee line, amount in numbers, and amount in words.
- Return only valid JSON matching the schema. No extra commentary.
`,
  });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: imageBuffer.toString('base64'),
      },
    },
  ]);

  const text = result.response.text();
  const parsed = JSON.parse(text);

  return {
    chequeNumber: String(parsed.chequeNumber || ''),
    payeeName: String(parsed.payeeName || ''),
    amount: String(parsed.amount || ''),
    date: String(parsed.date || ''),
    memo: String(parsed.memo || ''),
    bankName: String(parsed.bankName || ''),
    lineItems: (parsed.lineItems || []).map((item: { description?: string; amount?: string }) => ({
      description: item.description || '',
      amount: item.amount || '',
    })),
  };
}

export async function parseDocumentWithGemini(
  imageBuffer: Buffer,
  mimeType: string
): Promise<ParseDocumentResult> {
  const classification = await classifyDocument(imageBuffer, mimeType);
  let invoiceData = null;
  let chequeData = null;

  if (classification.documentType === 'INVOICE') {
    invoiceData = await parseInvoiceWithGemini(imageBuffer, mimeType);
  } else if (classification.documentType === 'CHEQUE') {
    chequeData = await parseChequeWithGemini(imageBuffer, mimeType);
  }

  return {
    classification,
    invoiceData,
    chequeData,
  };
}

const mappingSuggestionSchema: ArraySchema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      sourceField: { type: SchemaType.STRING, description: 'The original scan field name to map' },
      accountHint: { type: SchemaType.STRING, description: 'A useful QuickBooks account hint if an exact match is not available' },
      accountName: { type: SchemaType.STRING, description: 'The recommended QuickBooks account name if one is likely' },
      postingType: { type: SchemaType.STRING, description: 'Whether the field should be posted as Debit or Credit' },
      reason: { type: SchemaType.STRING, description: 'A short explanation of why this mapping was suggested' },
    },
    required: ['sourceField', 'accountHint', 'accountName', 'postingType', 'reason'],
  },
};

export async function suggestMappings(
  scanFields: string[],
  accountNames: string[],
  transactionType?: string,
  preferenceContext?: string,
  accountTypes?: { name: string; type: string; subType: string }[],
): Promise<Array<{ sourceField: string; accountHint: string; accountName: string; postingType: 'Debit' | 'Credit'; reason: string }>> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const fieldsText = scanFields.map((field) => `- ${field}`).join('\n');
  const accountsText = (accountTypes ?? accountNames.slice(0, 50).map((name) => ({ name, type: '', subType: '' })))
    .slice(0, 50)
    .map((account) => `- ${account.name} (${account.type}${account.subType ? ` • ${account.subType}` : ''})`)
    .join('\n');
  const preferenceText = preferenceContext
    ? `\n\nPreviously accepted mappings for this location:\n${preferenceContext}`
    : '';
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: mappingSuggestionSchema,
    },
    systemInstruction: `You are an expert restaurant accounting assistant. Given a list of POS scan field names and a list of available QuickBooks account names, recommend the best mapping for each field.

RULES:
- For each scan field, choose the most likely QuickBooks account from the list when possible.
- If you cannot identify an exact account name, provide a helpful account hint instead.
- Return whether the field should post as Debit or Credit.

ACCOUNTING RULES:
- DEBIT increases: Asset and Expense accounts
- CREDIT increases: Liability, Equity, and Income accounts
- When recommending postings, the posting type (Debit/Credit) MUST be consistent with the account type. For example:
  - Revenue/Sales fields should be CREDIT to Income accounts
  - Payment/Tender fields (Cash, Credit Card) should be DEBIT to Asset accounts
  - Tax collected should be CREDIT to Liability accounts
  - Discounts should be DEBIT to Expense or Contra-Income accounts
- Violating these rules without explanation is NOT acceptable.

- Use previously accepted mapping preferences for this location when they are available to improve consistency and reduce repeat corrections.
- Provide a concise reason for each recommendation.
- Return ONLY valid JSON that matches the schema. No extra commentary.`,
  });

  const prompt = `Scan Fields:\n${fieldsText}\n\nAvailable QuickBooks Accounts (Type • SubType):\n${accountsText}${accountTypes && accountTypes.length > 50 ? '\n- ...and more' : ''}\n\nTransaction Type: ${transactionType ?? 'Unknown'}${preferenceText}`;
  const result = await model.generateContent([{ text: prompt }]);
  const text = result.response.text();
  const parsed = JSON.parse(text);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map((item: any) => ({
    sourceField: String(item.sourceField || ''),
    accountHint: String(item.accountHint || ''),
    accountName: String(item.accountName || ''),
    postingType: item.postingType === 'Debit' ? 'Debit' : 'Credit',
    reason: String(item.reason || ''),
  }));
}

export async function parseInvoiceWithGemini(
  imageBuffer: Buffer,
  mimeType: string
): Promise<{
  header: { vendor: string; invoiceNumber: string; invoiceDate: string; dueDate: string; total: string };
  lineItems: { description: string; quantity: string; unitPrice: string; total: string }[];
}> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: invoiceSchema,
    },
    systemInstruction: `You are an expert accounts payable assistant. Extract structured data from restaurant/vendor invoices.

RULES:
- Extract the vendor/supplier name exactly as written on the invoice.
- Find the invoice number (may be labeled "Invoice #", "INV", "Bill No", etc.).
- Parse dates to YYYY-MM-DD format when possible. If the format is ambiguous, return the raw string.
- The "total" field must be the GRAND TOTAL (after all taxes, fees, discounts). Look for keywords like "Grand Total", "Total Due", "Amount Due", "Balance Due".
- For line items, extract each product/service line. Skip subtotals, tax lines, and summary rows.
- If a field is not found on the invoice, return an empty string "" for it.
- Return ONLY the JSON structure matching the schema. No extra commentary.
- For monetary amounts, return only digits and a decimal point (e.g. "1234.56"). No currency symbols.`,
  });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: imageBuffer.toString('base64'),
      },
    },
  ]);

  const text = result.response.text();
  const parsed = JSON.parse(text);

  return {
    header: {
      vendor: parsed.vendor || '',
      invoiceNumber: parsed.invoiceNumber || '',
      invoiceDate: parsed.invoiceDate || '',
      dueDate: parsed.dueDate || '',
      total: parsed.total || '',
    },
    lineItems: (parsed.lineItems || []).map(
      (item: { description?: string; quantity?: string; unitPrice?: string; total?: string }) => ({
        description: item.description || '',
        quantity: item.quantity || '',
        unitPrice: item.unitPrice || '',
        total: item.total || '',
      })
    ),
  };
}
