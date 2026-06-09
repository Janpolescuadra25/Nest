import OpenAI from 'openai';
import pdfParse from 'pdf-parse';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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

function getMediaType(filename: string): string {
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

export async function extractFromImage(buffer: Buffer, filename: string): Promise<ExtractedInvoice> {
  const base64 = buffer.toString('base64');
  const mediaType = getMediaType(filename);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract the invoice data from this image.' },
          {
            type: 'image_url',
            image_url: { url: `data:${mediaType};base64,${base64}` },
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000,
    temperature: 0,
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error('No response from OpenAI');

  return JSON.parse(content) as ExtractedInvoice;
}

export async function extractFromPDF(buffer: Buffer): Promise<ExtractedInvoice> {
  const pdfParseFn = pdfParse as unknown as (data: Buffer) => Promise<{ text?: string }>;
  const pdfData = await pdfParseFn(buffer);
  const text = pdfData.text;

  if (!text || text.trim().length < 10) {
    throw new Error('Could not extract meaningful text from PDF');
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      {
        role: 'user',
        content: `Extract the invoice data from this text:\n\n${text}`,
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000,
    temperature: 0,
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error('No response from OpenAI');

  return JSON.parse(content) as ExtractedInvoice;
}
