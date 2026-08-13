import express from 'express';
import request from 'supertest';
import Excel from 'exceljs';
import templateRoutes from '../src/routes/templates';
import { createErrorHandler } from '../src/lib/errors';

jest.mock('../src/middleware/auth.middleware', () => ({
  authenticate: (req: any, res: any, next: any) => next(),
  requireFeaturePermission: (resource: string, action: string) => (req: any, res: any, next: any) => next(),
  locationFilter: (user: any) => ({}),
}));

jest.mock('../src/middleware/effective-role', () => ({
  enforceEffectiveRole: (req: any, res: any, next: any) => next(),
}));

jest.mock('../src/lib/prisma', () => {
  const __prismaMocks = {
    template: {
      findFirst: jest.fn(),
    },
  };

  return {
    __prismaMocks,
    prisma: __prismaMocks,
  };
});

jest.mock('../src/middleware/capacity', () => ({
  requireCapacity: () => (req: any, res: any, next: any) => next(),
}));

const { prisma } = jest.requireMock('../src/lib/prisma') as any;
const mockTemplateFindFirst = prisma.template.findFirst as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/templates', templateRoutes);
  app.use(createErrorHandler());
  return app;
}

async function createChequeWorkbook(data: string[][]): Promise<Buffer> {
  const workbook = new Excel.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  for (const row of data) {
    sheet.addRow(row);
  }
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('Cheque fixed-column Excel parser', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTemplateFindFirst.mockResolvedValue({
      id: 'test-template-1',
      transactionType: 'CHEQUE',
      columnMappings: null,
    });
    app = buildApp();
  });

  it('parses a valid 3-row cheque Excel file into 3 transactions', async () => {
    const data = [
      ['Payee', 'Bank Account', 'Payment Date', 'Check No.', 'Category', 'Description', 'Amount', 'Tax', 'Customer', 'QB Memo', 'Tax Type'],
      ['Vendor A', 'Bank 1', '2026-08-08', '1001', 'Office Supplies', 'Pens', '150.00', 'Exclusive', 'Customer A', 'Memo A', 'Taxable'],
      ['Vendor B', 'Bank 2', '2026-08-09', '1002', 'Meals', 'Lunch', '200.00', 'Inclusive', 'Customer B', 'Memo B', 'NonTaxable'],
      ['Vendor A', 'Bank 1', '2026-08-10', '1003', 'Travel', 'Taxi', '75.50', 'Out of Scope', 'Customer A', 'Memo C', 'Taxable'],
    ];
    const buf = await createChequeWorkbook(data);

    const res = await request(app)
      .post('/api/templates/parse-excel-data?templateId=test-template-1')
      .attach('file', buf, {
        filename: 'test.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(3);
    expect(res.body.totalRows).toBe(3);
    expect(res.body.skippedRows).toBe(0);
    expect(res.body.transactions[0].type).toBe('CHEQUE');
    expect(res.body.transactions[0].header.payeeName).toBe('Vendor A');
    expect(res.body.transactions[0].header.checkNo).toBe('1001');
    expect(res.body.transactions[0].lineItems[0].category).toBe('Office Supplies');
    expect(Number(res.body.transactions[0].lineItems[0].amount)).toBe(150);
  });

  it('returns 400 when the row count is not exactly 11 columns', async () => {
    const data = [
      ['Payee', 'Bank Account', 'Payment Date', 'Check No.', 'Category', 'Description', 'Amount', 'Tax', 'Customer'],
      ['Vendor A', 'Bank 1', '2026-08-08', '1001', 'Office Supplies', 'Pens', '150.00', 'Exclusive', 'Customer A'],
    ];
    const buf = await createChequeWorkbook(data);

    const res = await request(app)
      .post('/api/templates/parse-excel-data?templateId=test-template-1')
      .attach('file', buf, {
        filename: 'test.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('exactly 11 columns');
  });

  it('returns 400 when headers do not match expected names', async () => {
    const data = [
      ['Vendor', 'Bank Account', 'Payment Date', 'Check No.', 'Category', 'Description', 'Amt', 'Tax', 'Customer', 'QB Memo', 'Tax Type'],
      ['Vendor A', 'Bank 1', '2026-08-08', '1001', 'Office Supplies', 'Pens', '150.00', 'Exclusive', 'Customer A', 'Memo A', 'Taxable'],
    ];
    const buf = await createChequeWorkbook(data);

    const res = await request(app)
      .post('/api/templates/parse-excel-data?templateId=test-template-1')
      .attach('file', buf, {
        filename: 'test.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Header mismatch');
    expect(res.body.error.toLowerCase()).toContain('payee');
    expect(res.body.error.toLowerCase()).toContain('amount');
  });

  it('returns 400 when only the header row is present', async () => {
    const data = [
      ['Payee', 'Bank Account', 'Payment Date', 'Check No.', 'Category', 'Description', 'Amount', 'Tax', 'Customer', 'QB Memo', 'Tax Type'],
    ];
    const buf = await createChequeWorkbook(data);

    const res = await request(app)
      .post('/api/templates/parse-excel-data?templateId=test-template-1')
      .attach('file', buf, {
        filename: 'test.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('at least a header row and one data row');
  });

  it('skips invalid amount rows and returns skippedRows count', async () => {
    const data = [
      ['Payee', 'Bank Account', 'Payment Date', 'Check No.', 'Category', 'Description', 'Amount', 'Tax', 'Customer', 'QB Memo', 'Tax Type'],
      ['Vendor A', 'Bank 1', '2026-08-08', '1001', 'Office Supplies', 'Pens', '150.00', 'Exclusive', 'Customer A', 'Memo A', 'Taxable'],
      ['Vendor B', 'Bank 2', '2026-08-09', '1002', 'Meals', 'Lunch', 'N/A', 'Inclusive', 'Customer B', 'Memo B', 'NonTaxable'],
      ['Vendor C', 'Bank 3', '2026-08-10', '1003', 'Travel', 'Taxi', '1000.00', 'Out of Scope', 'Customer C', 'Memo C', 'Taxable'],
    ];
    const buf = await createChequeWorkbook(data);

    const res = await request(app)
      .post('/api/templates/parse-excel-data?templateId=test-template-1')
      .attach('file', buf, {
        filename: 'test.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(2);
    expect(res.body.totalRows).toBe(3);
    expect(res.body.skippedRows).toBe(1);
  });

  it('accepts headers case-insensitively', async () => {
    const data = [
      ['PAYEE', 'bank account', 'Payment Date', 'check no.', 'Category', 'Description', 'amount', 'Tax', 'Customer', 'QB MEMO', 'Tax Type'],
      ['Vendor A', 'Bank 1', '2026-08-08', '1001', 'Office Supplies', 'Pens', '150.00', 'Exclusive', 'Customer A', 'Memo A', 'Taxable'],
    ];
    const buf = await createChequeWorkbook(data);

    const res = await request(app)
      .post('/api/templates/parse-excel-data?templateId=test-template-1')
      .attach('file', buf, {
        filename: 'test.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
  });
});

describe('Bill fixed-column Excel parser', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTemplateFindFirst.mockResolvedValue({
      id: 'test-template-2',
      transactionType: 'BILL',
      columnMappings: null,
    });
    app = buildApp();
  });

  it('parses a valid bill Excel file into a bill transaction', async () => {
    const data = [
      ['Date', 'Vendor', 'Bill No', 'Due Date', 'Account', 'Tax Type', 'Amount', 'Memo', 'Terms', 'PO Number', 'Department'],
      ['2026-08-10', 'Vendor A', 'BILL-1001', '2026-08-30', 'Accounts Payable', 'Taxable', '250.00', 'Office supplies', 'Net 30', 'PO-123', 'Operations'],
    ];
    const buf = await createChequeWorkbook(data);

    const res = await request(app)
      .post('/api/templates/parse-excel-data?templateId=test-template-2')
      .attach('file', buf, {
        filename: 'bill.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0].type).toBe('BILL');
    expect(res.body.transactions[0].header.date).toBe('2026-08-10');
    expect(res.body.transactions[0].header.vendor).toBe('Vendor A');
    expect(res.body.transactions[0].header.docNumber).toBe('BILL-1001');
    expect(res.body.transactions[0].header.dueDate).toBe('2026-08-30');
    expect(res.body.transactions[0].header.account).toBe('Accounts Payable');
    expect(res.body.transactions[0].header.taxType).toBe('Taxable');
    expect(res.body.transactions[0].header.memo).toBe('Office supplies');
    expect(res.body.transactions[0].header.terms).toBe('Net 30');
    expect(res.body.transactions[0].header.poNumber).toBe('PO-123');
    expect(res.body.transactions[0].header.department).toBe('Operations');
    expect(res.body.transactions[0].lineItems[0].amount).toBe('250.00');
    expect(res.body.totalRows).toBe(1);
    expect(res.body.skippedRows).toBe(0);
  });

  it('parses bill headers case-insensitively and recognizes Bill Number', async () => {
    const data = [
      ['date', 'vendor', 'Bill Number', 'due date', 'ACCOUNT', 'tax type', 'amount'],
      ['2026-08-10', 'Vendor B', 'BILL-2002', '2026-09-05', 'Accounts Payable', 'NonTaxable', '125.00'],
    ];
    const buf = await createChequeWorkbook(data);

    const res = await request(app)
      .post('/api/templates/parse-excel-data?templateId=test-template-2')
      .attach('file', buf, {
        filename: 'bill.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(200);
    expect(res.body.transactions[0].type).toBe('BILL');
    expect(res.body.transactions[0].header.docNumber).toBe('BILL-2002');
  });
});
