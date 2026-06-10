import { GoogleGenerativeAI } from '@google/generative-ai';
import pdfParse from 'pdf-parse';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0,
  },
});

const EXTRACTION_PROMPT = `You are an invoice data extraction assistant for a restaurant accounting system. Extract structured data from the provided invoice.

Return a JSON object with this exact structure:
{
  "header": {
    "vendor": "Vendor/restaurant/supplier name",
    "invoiceNumber": "Invoice number or reference",
    "invoiceDate": "Invoice date in YYYY-MM-DD format",
    "dueDate": "Due date in YYYY-MM-DD format (if present)",
    "memo": "Any notes or memo line",
    "total": "Total amount as a number string"
  },
  "lineItems": [
    {
      "description": "Item description",
      "amount": "Line amount as a number string",
      "account": "Suggested account category (if inferable)",
      "quantity": "Quantity (if present)"
    }
  ]
}

Rules:
- If a field is not found, use empty string ""
- amounts should be plain numbers, no currency symbols or commas
- If multiple pages/sections exist, combine all line items
- For line items, include EVERY line item on the invoice
- If no line items are found, return empty array
- Only return valid JSON, no markdown or explanation`;

export interface ExtractedInvoice {
  header: Record<string, string>;
  lineItems: Record<string, string>[];
}

function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'image/jpeg';
  }
}

function validateExtractedInvoice(parsed: ExtractedInvoice): ExtractedInvoice {
  const hasData = Object.values(parsed.header).some((value) => value?.trim().length > 0) || (parsed.lineItems?.length ?? 0) > 0;
  if (!hasData) {
    throw new Error('Could not extract data from image — image may be too blurry or not an invoice');
  }
  return parsed;
}

export async function extractFromImage(buffer: Buffer, filename: string): Promise<ExtractedInvoice> {
  const base64 = buffer.toString('base64');
  const mimeType = getMimeType(filename);

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: base64,
      },
    },
    {
      text: 'Extract the invoice data from this image. Return a JSON object with header and lineItems.',
    },
  ]);

  const text = result.response.text();
  if (!text || text.trim().length === 0) {
    throw new Error('Could not extract data from image — image may be too blurry or empty');
  }

  const parsed = JSON.parse(text) as ExtractedInvoice;
  return validateExtractedInvoice(parsed);
}

export async function extractFromPDF(buffer: Buffer): Promise<ExtractedInvoice> {
  const pdfParseFn = pdfParse as unknown as (data: Buffer) => Promise<{ text?: string }>;
  const pdfData = await pdfParseFn(buffer);
  const text = pdfData.text;

  if (!text || text.trim().length < 10) {
    throw new Error('Could not extract meaningful text from PDF');
  }

  const result = await model.generateContent(
    `Extract the invoice data from this text. Return a JSON object with header and lineItems.\n\n${text}`
  );

  const responseText = result.response.text();
  if (!responseText || responseText.trim().length === 0) {
    throw new Error('Could not parse invoice data from extracted PDF text');
  }

  return JSON.parse(responseText) as ExtractedInvoice;
}
