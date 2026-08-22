import { GoogleGenerativeAI, ArraySchema, ObjectSchema, SchemaType } from '@google/generative-ai';
import { AppError } from './errors';
import type { POSDetectionResult, POSReportData } from '../types';

// Simple in-memory rate limiter for Gemini API (15 RPM limit, using 13 to leave buffer)
const geminiCallTimestamps: number[] = [];
const GEMINI_RPM_LIMIT = 13;
const GEMINI_QUEUE_TIMEOUT_MS = 10_000;
const ENTITY_CAP = 200;

async function waitForGeminiSlot(): Promise<void> {
  const now = Date.now();

  while (geminiCallTimestamps.length > 0 && geminiCallTimestamps[0] < now - 60_000) {
    geminiCallTimestamps.shift();
  }

  if (geminiCallTimestamps.length < GEMINI_RPM_LIMIT) {
    geminiCallTimestamps.push(now);
    return;
  }

  const waitMs = geminiCallTimestamps[0] + 60_000 - now;
  if (waitMs > GEMINI_QUEUE_TIMEOUT_MS) {
    throw new Error('Scan queue is full. Please try again in a moment.');
  }

  await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs + 100, GEMINI_QUEUE_TIMEOUT_MS)));
  return waitForGeminiSlot();
}

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

export type ValueMappingFieldType = 'account' | 'name' | 'class' | 'taxCode' | 'bankAccount' | 'taxType';

export const VALID_VALUE_MAPPING_FIELD_TYPES = ['account', 'name', 'class', 'taxCode', 'bankAccount', 'taxType'] as const;

export type ValueMappingFieldTypeString = (typeof VALID_VALUE_MAPPING_FIELD_TYPES)[number];

export interface ValueMappingSuggestion {
  sourceField: string;
  fieldType: ValueMappingFieldTypeString;
  scannedText: string;
  suggestedEntityId: string;
  suggestedEntityName: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

const valueMappingSuggestionSchema: ArraySchema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      sourceField: { type: SchemaType.STRING, description: 'The scan source field that produced this value' },
      fieldType: { type: SchemaType.STRING, description: 'The type of value mapping (account, name, class, or taxCode)' },
      scannedText: { type: SchemaType.STRING, description: 'The original scanned value text' },
      suggestedEntityId: { type: SchemaType.STRING, description: 'The suggested QuickBooks entity Id' },
      suggestedEntityName: { type: SchemaType.STRING, description: 'The suggested QuickBooks entity name' },
      confidence: { type: SchemaType.STRING, description: 'Confidence level: high, medium, or low' },
      reason: { type: SchemaType.STRING, description: 'Brief explanation of why this entity was suggested' },
    },
    required: ['sourceField', 'fieldType', 'scannedText', 'suggestedEntityId', 'suggestedEntityName', 'confidence', 'reason'],
  },
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

  await waitForGeminiSlot();

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: classificationSchema,
    },
    systemInstruction: `You are an expert document classifier for business automation. Identify the document type for the image provided. The categories are:
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
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError('AI returned an invalid response format', 502);
  }
  if (!parsed) {
    throw new AppError('AI returned an empty response', 502);
  }

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

  await waitForGeminiSlot();

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
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError('AI returned an invalid response format', 502);
  }
  if (!parsed) {
    throw new AppError('AI returned an empty response', 502);
  }

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

const posDetectionSchema: ObjectSchema = {
  type: SchemaType.OBJECT,
  properties: {
    isPOS: { type: SchemaType.BOOLEAN, description: 'Whether the image shows a POS system' },
    posType: { type: SchemaType.STRING, description: 'Identified POS brand or null', nullable: true },
    confidence: { type: SchemaType.NUMBER, description: 'Detection confidence 0.0-1.0' },
    reasoning: { type: SchemaType.STRING, description: 'Brief explanation of the detection' },
  },
  required: ['isPOS', 'posType', 'confidence', 'reasoning'],
};

const posReportSchema: ObjectSchema = {
  type: SchemaType.OBJECT,
  properties: {
    rawData: {
      type: SchemaType.OBJECT,
      properties: {},
      description: 'Map of section.field to numeric value, e.g. {"Revenue.Food Sales": 1234.56}',
    },
    scanDate: { type: SchemaType.STRING, description: 'YYYY-MM-DD date' },
    totalSales: { type: SchemaType.NUMBER, description: 'Grand total amount' },
    paymentBreakdown: {
      type: SchemaType.OBJECT,
      properties: {},
      description: 'Map of payment method to amount, e.g. {"Cash": 500, "Credit Card": 734.56}',
    },
  },
  required: ['rawData', 'scanDate', 'totalSales'],
};

export async function detectPOS(imageBuffer: Buffer, mimeType: string): Promise<POSDetectionResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  await waitForGeminiSlot();

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: posDetectionSchema,
    },
    systemInstruction: `You are an expert at identifying Point-of-Sale (POS) systems from screenshots of web pages.

A POS system typically displays:
- Sales reports with revenue categories (Food, Beverage, Tax, Discounts)
- Payment method breakdowns (Cash, Credit Card, Gift Card)
- Order summaries or transaction lists
- Daily/weekly/monthly sales totals
- Tip amounts, gratuity lines
- Check or order numbers
- Employee or server names associated with orders
- Time-based sales data (hourly breakdowns, daily periods)
- Net sales, gross sales, or total revenue prominently displayed

This is NOT a POS system:
- E-commerce product pages or shopping carts
- Bank or financial dashboards
- Email clients or inboxes
- Social media pages
- General business websites (About pages, online menus without sales data)
- Accounting software dashboards (QuickBooks, Xero)
- Inventory management screens without sales data
- Booking or reservation systems without transaction data

Identify the specific POS brand if possible from the visual layout and any visible branding. Known brands to look for: Toast, Square, Clover, Lightspeed, SALIDO, Oracle Simphony, Revel Systems, NCR Aloha, TouchBistro, ShopKeep, Brink POS, Harbortouch, Heartland, Lavu, Bindo. If it is clearly a POS but you cannot identify the brand, use "unknown_pos".

Return confidence as a number between 0.0 and 1.0:
- 0.8 to 1.0: Very confident this is a POS system
- 0.6 to 0.8: Likely a POS system but some uncertainty
- Below 0.6: Probably not a POS system

Return only valid JSON matching the response schema. No extra commentary.
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
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError('AI returned an invalid response format', 502);
  }
  if (!parsed) {
    throw new AppError('AI returned an empty response', 502);
  }

  const detection: POSDetectionResult = {
    isPOS: Boolean(parsed.isPOS),
    posType: parsed.posType == null ? null : String(parsed.posType),
    confidence: Number(parsed.confidence) || 0,
    reasoning: String(parsed.reasoning || ''),
  };

  if (detection.confidence < 0.6) {
    detection.isPOS = false;
    detection.reasoning = `${detection.reasoning || 'Low confidence detection'} (low confidence)`;
  }

  return detection;
}

export async function parsePOSReport(
  imageBuffer: Buffer,
  mimeType: string,
  detectedPOS: string,
): Promise<POSReportData> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  await waitForGeminiSlot();

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: posReportSchema,
    },
    systemInstruction: `You are an expert at extracting structured sales data from POS system screenshots.

The user has identified this as a ${detectedPOS} POS system. Extract ALL visible sales and revenue data into the structured format specified.

Rules:
- Extract every revenue or sales category visible on screen (e.g., "Food Sales", "Beverage Sales", "Alcohol Sales", "Merchandise", "Catering", etc.)
- Use the EXACT category names as displayed on screen — do not rename or normalize them
- Extract payment method breakdowns if visible (Cash, Credit Card, Debit, Gift Card, Apple Pay, etc.)
- Extract tax amounts if visible (Sales Tax, VAT, GST, etc.)
- Extract tip or gratuity totals if visible
- Extract discount or comp amounts if visible
- The "totalSales" must be the GRAND TOTAL — the final settlement amount or net total after all adjustments
- For "scanDate", look for a date displayed on the report (e.g., "Sales Report for July 14, 2026"). If no date is visible, return today's date in YYYY-MM-DD format
- All monetary values must be positive numbers. No negatives, no currency symbols, no commas
- For the "rawData" map, use dot-prefixed keys by section:
  - Revenue categories: "Revenue.Food Sales", "Revenue.Beverage Sales", etc.
  - Taxes: "Tax.Sales Tax", "Tax.VAT", etc.
  - Discounts: "Discounts.Comps", "Discounts.Promotions", etc.
  - Payments: "Payments.Cash", "Payments.Credit Card", etc.
  - Tips: "Tips.Credit Card Tips", "Tips.Cash Tips", etc.
- If a value cannot be determined from the screenshot, omit it from the map — do not guess or fabricate values

Return only valid JSON matching the response schema. No extra commentary.
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
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError('AI returned an invalid response format', 502);
  }
  if (!parsed) {
    throw new AppError('AI returned an empty response', 502);
  }

  const rawData: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed.rawData || {})) {
    rawData[key] = Number(value) || 0;
  }

  const paymentBreakdown: Record<string, number> = {};
  if (parsed.paymentBreakdown) {
    for (const [key, value] of Object.entries(parsed.paymentBreakdown)) {
      paymentBreakdown[key] = Number(value) || 0;
    }
  }

  const scanDateString = String(parsed.scanDate || '').trim();
  const scanDate = scanDateString || new Date().toISOString().slice(0, 10);

  return {
    rawData,
    scanDate,
    totalSales: Number(parsed.totalSales) || 0,
    paymentBreakdown: Object.keys(paymentBreakdown).length ? paymentBreakdown : undefined,
  };
}

export async function parseDocumentWithGemini(
  imageBuffer: Buffer,
  mimeType: string
): Promise<ParseDocumentResult> {
  const classification = await classifyDocument(imageBuffer, mimeType);
  let invoiceData = null;
  let chequeData = null;

  if (classification.documentType === 'INVOICE' || classification.documentType === 'RECEIPT') {
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

const productMappingSuggestionSchema: ArraySchema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      productName: { type: SchemaType.STRING, description: 'The scanned product name from a line item' },
      accountHint: { type: SchemaType.STRING, description: 'A useful QuickBooks account hint if an exact match is not available' },
      accountName: { type: SchemaType.STRING, description: 'The recommended QuickBooks account name if one is likely' },
      postingType: { type: SchemaType.STRING, description: 'Whether the field should be posted as Debit or Credit' },
      reason: { type: SchemaType.STRING, description: 'A short explanation of why this mapping was suggested' },
    },
    required: ['productName', 'accountHint', 'accountName', 'postingType', 'reason'],
  },
};

export async function suggestProductMappings(
  productNames: string[],
  accountNames: string[],
  transactionType?: string,
  accountTypes?: { name: string; type: string; subType: string }[],
): Promise<Array<{ productName: string; accountHint: string; accountName: string; postingType: 'Debit' | 'Credit'; reason: string }>> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  await waitForGeminiSlot();

  const ACCOUNT_CAP = 100;
  const productText = productNames.map((product) => `- ${product}`).join('\n');
  const accountsText = (accountTypes ?? accountNames.slice(0, ACCOUNT_CAP).map((name) => ({ name, type: '', subType: '' })))
    .slice(0, ACCOUNT_CAP)
    .map((account) => `- ${account.name} (${account.type}${account.subType ? ` • ${account.subType}` : ''})`)
    .join('\n');
  const transactionText = transactionType ? `Transaction Type: ${transactionType}` : 'Transaction Type: Unknown';

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: productMappingSuggestionSchema,
    },
    systemInstruction: `You are an expert accounting assistant. Given a list of scanned product names and a QuickBooks account list, recommend the best account mapping for each product.

RULES:
- For each product name, choose the most likely QuickBooks account from the list when possible.
- If you cannot identify an exact account name, provide a helpful account hint instead.
- Return whether the product should post as Debit or Credit.

ACCOUNTING RULES:
- DEBIT increases: Asset and Expense accounts
- CREDIT increases: Liability, Equity, and Income accounts
- Revenue or product sales should typically post as Credit to Income accounts
- Payment or cost of goods sold related products may post as Debit to Asset or Expense accounts
- Tax-related products should post as Credit to Liability accounts when they represent collected tax
- Discounts or refunds often post as Debit to Expense or Contra-Income accounts
- Avoid suggesting a posting type that contradicts the account type list

- Return ONLY valid JSON that matches the schema. No extra commentary.`,
  });

  const prompt = `Scanned Products:
${productText}

Available QuickBooks Accounts (Type • SubType):
${accountsText}

${transactionText}`;
  const result = await model.generateContent([{ text: prompt }]);
  const text = result.response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError('AI returned an invalid response format', 502);
  }
  if (!parsed) {
    throw new AppError('AI returned an empty response', 502);
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map((item: any) => ({
    productName: String(item.productName || ''),
    accountHint: String(item.accountHint || ''),
    accountName: String(item.accountName || ''),
    postingType: item.postingType === 'Debit' ? 'Debit' : 'Credit',
    reason: String(item.reason || ''),
  }));
}

export async function suggestMappings(
  scanFields: string[],
  accountNames: string[],
  transactionType?: string,
  preferenceContext?: string,
  accountTypes?: { name: string; type: string; subType: string }[],
): Promise<Array<{ sourceField: string; accountHint: string; accountName: string; postingType: 'Debit' | 'Credit'; reason: string }>> {
  if (!process.env.GEMINI_API_KEY) {
    throw new AppError('GEMINI_API_KEY is not configured', 503);
  }

  await waitForGeminiSlot();

  const ACCOUNT_CAP = 100;

  const fieldsText = scanFields.map((field) => `- ${field}`).join('\n');
  const accountsText = (accountTypes ?? accountNames.slice(0, ACCOUNT_CAP).map((name) => ({ name, type: '', subType: '' })))
    .slice(0, ACCOUNT_CAP)
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
    systemInstruction: `You are an expert accounting assistant. Given a list of POS scan field names and a list of available QuickBooks account names, recommend the best mapping for each field.

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

  const prompt = `Scan Fields:\n${fieldsText}\n\nAvailable QuickBooks Accounts (Type • SubType):\n${accountsText}${accountTypes && accountTypes.length > ACCOUNT_CAP ? '\n- ...and more' : ''}\n\nTransaction Type: ${transactionType ?? 'Unknown'}${preferenceText}`;
  try {
    const result = await model.generateContent([{ text: prompt }]);
    const text = result.response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AppError('AI returned an invalid response format', 502);
    }
    if (!parsed) {
      throw new AppError('AI returned an empty response', 502);
    }

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
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError('AI suggestion service is temporarily unavailable. Please try again later.', 503);
  }
}

export async function parseInvoiceWithGemini(
  imageBuffer: Buffer,
  mimeType: string
): Promise<{
  header: { vendor: string; invoiceNumber: string; invoiceDate: string; dueDate: string; total: string };
  lineItems: { description: string; quantity: string; unitPrice: string; total: string }[];
}> {
  if (!process.env.GEMINI_API_KEY) {
    throw new AppError('GEMINI_API_KEY is not configured', 503);
  }

  await waitForGeminiSlot();

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: invoiceSchema,
    },
    systemInstruction: `You are an expert accounts payable assistant. Extract structured data from vendor invoices.

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
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError('AI returned an invalid response format', 502);
  }
  if (!parsed) {
    throw new AppError('AI returned an empty response', 502);
  }

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
export async function suggestValueMappings(params: {
  valueCategories: Array<{
    sourceField: string;
    fieldType: 'account' | 'name' | 'class' | 'taxCode' | 'bankAccount' | 'taxType';
    scannedValues: string[];
  }>;
  qbEntities: {
    accounts: Array<{ Id: string; FullyQualifiedName: string; AccountType?: string; AccountSubType?: string }>;
    vendors: Array<{ Id: string; DisplayName?: string; FullyQualifiedName?: string }>;
    customers: Array<{ Id: string; DisplayName?: string; FullyQualifiedName?: string }>;
    taxCodes: Array<{ Id: string; Name?: string; FullyQualifiedName?: string }>;
  };
  transactionType?: string;
}): Promise<ValueMappingSuggestion[]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new AppError('GEMINI_API_KEY is not configured', 503);
  }

  const cleanedCategories = params.valueCategories
    .map((category) => ({
      sourceField: category.sourceField,
      fieldType: category.fieldType,
      scannedValues: category.scannedValues
        .filter((value) => typeof value === 'string' && value.trim() !== '')
        .map((value) => {
          const text = value.trim();
          return text.length > 100 ? `${text.slice(0, 97)}...` : text;
        })
        .slice(0, 50),
    }))
    .filter((category) => category.fieldType !== 'class' && category.scannedValues.length > 0);

  if (cleanedCategories.length === 0) {
    return [];
  }

  await waitForGeminiSlot();

  const accountEntities = params.qbEntities.accounts.slice(0, ENTITY_CAP);
  const vendorEntities = params.qbEntities.vendors.slice(0, ENTITY_CAP);
  const customerEntities = params.qbEntities.customers.slice(0, ENTITY_CAP);
  const taxCodeEntities = params.qbEntities.taxCodes.slice(0, ENTITY_CAP);

  const buildEntityList = (
    items: Array<{ Id: string; FullyQualifiedName?: string; DisplayName?: string; Name?: string; AccountType?: string; AccountSubType?: string }>,
    includeType?: boolean,
  ) =>
    items
      .map((item) => {
        const entityName = item.FullyQualifiedName || item.DisplayName || item.Name || '[Unnamed]';
        return includeType
          ? `- ${entityName} (${item.AccountType || ''}${item.AccountSubType ? ` • ${item.AccountSubType}` : ''})`
          : `- ${entityName}`;
      })
      .join('\n');

  const categoriesText = cleanedCategories
    .map((category) => `- ${category.sourceField} (${category.fieldType})\n${category.scannedValues.map((value) => `  - ${value}`).join('\n')}`)
    .join('\n\n');

  const entitiesText = [
    accountEntities.length > 0 && `Accounts:\n${buildEntityList(accountEntities, true)}`,
    vendorEntities.length > 0 && `Vendors:\n${buildEntityList(vendorEntities)}`,
    customerEntities.length > 0 && `Customers:\n${buildEntityList(customerEntities)}`,
    taxCodeEntities.length > 0 && `Tax Codes:\n${buildEntityList(taxCodeEntities)}`,
  ].filter(Boolean).join('\n\n');

  const transactionText = params.transactionType ? `\n\nTransaction Type: ${params.transactionType}` : '';

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: valueMappingSuggestionSchema,
    },
    systemInstruction: `You are an expert accounting assistant. Given a list of scanned values and available QuickBooks entities, recommend the best entity for each scanned value.

RULES:
- For each scanned value, choose the most likely QuickBooks entity from the appropriate list.
- If the fieldType is 'name', match against vendors and customers.
- If the fieldType is 'account' or 'bankAccount', match against accounts.
- If the fieldType is 'taxCode' or 'taxType', match against tax codes.
- If there is no good match, return the closest entity and mark confidence as low.
- Do not produce entities for fieldType 'class'.
- Return exactly valid JSON with the schema below and no extra commentary.

Output should be an array of suggestions with the same sourceField and fieldType for each scanned value. Use high, medium, or low confidence and include a short reason for each recommendation.
`,
  });

  try {
    const prompt = `Value Categories:\n${categoriesText}\n\nAvailable QuickBooks Entities:\n${entitiesText}${transactionText}`;
    const result = await model.generateContent([{ text: prompt }]);
    const text = result.response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AppError('AI returned an invalid response format', 502);
    }
    if (!parsed) {
      throw new AppError('AI returned an empty response', 502);
    }
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item: any) => {
      const rawFieldType = String(item.fieldType || '');
      const fieldType = VALID_VALUE_MAPPING_FIELD_TYPES.includes(rawFieldType as ValueMappingFieldTypeString)
        ? (rawFieldType as ValueMappingFieldTypeString)
        : 'name';

      return {
        sourceField: String(item.sourceField || ''),
        fieldType,
        scannedText: String(item.scannedText || ''),
        suggestedEntityId: String(item.suggestedEntityId || ''),
        suggestedEntityName: String(item.suggestedEntityName || ''),
        confidence: ['high', 'medium', 'low'].includes(String(item.confidence).toLowerCase())
          ? (String(item.confidence).toLowerCase() as 'high' | 'medium' | 'low')
          : 'low',
        reason: String(item.reason || ''),
      };
    });
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError('AI value suggestion service is temporarily unavailable. Please try again later.', 503);
  }
}