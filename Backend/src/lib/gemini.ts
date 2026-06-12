import { GoogleGenerativeAI, ObjectSchema, SchemaType } from '@google/generative-ai';

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
