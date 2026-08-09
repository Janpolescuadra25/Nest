import { qbService } from '../src/services/qb.service';
import { chequeSchema } from '../src/lib/validators';

const validInput = {
  realmId: 'realm-1',
  accessToken: 'token-1',
  txnDate: '2026-01-15',
  bankAccountRef: { value: 'bank-1', name: 'Main Bank' },
  payeeRef: { value: 'vendor-1', name: 'ACME Corp' },
  amount: 1500,
  lines: [
    {
      amount: 1500,
      accountRef: { value: 'acc-1', name: 'Rent Expense' },
    },
  ],
};

describe('Cheque customerRef support', () => {
  it('includes CustomerRef in the QB payload when customerRef is provided', () => {
    const result = qbService.buildChequePayload({
      ...validInput,
      customerRef: { value: 'cust-123', name: 'ACME Corp' },
    });

    expect(result).toEqual(expect.objectContaining({
      CustomerRef: { value: 'cust-123' },
    }));
  });

  it('does not include CustomerRef when customerRef is not provided', () => {
    const result = qbService.buildChequePayload(validInput);

    expect(result).not.toHaveProperty('CustomerRef');
  });

  it('retains customerRef through chequeSchema parsing', () => {
    const parsed = chequeSchema.parse({
      txnDate: '2026-01-15',
      bankAccountRef: { value: 'bank-1', name: 'Main Bank' },
      payeeRef: { value: 'vendor-1', name: 'ACME Corp' },
      customerRef: { value: 'cust-123', name: 'ACME Corp' },
      amount: 1500,
      lines: [
        {
          amount: 1500,
          accountRef: { value: 'acc-1', name: 'Rent Expense' },
        },
      ],
    });

    expect(parsed.customerRef).toEqual({ value: 'cust-123', name: 'ACME Corp' });
  });
});
