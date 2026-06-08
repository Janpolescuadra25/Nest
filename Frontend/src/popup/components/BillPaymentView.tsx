import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useQBContext } from '../contexts/QBContext';
import { useQuickBooks } from '../hooks/useQuickBooks';
import SearchableSelect from './SearchableSelect';
import SmartDatePicker from './SmartDatePicker';
import type { OutstandingBill, VendorCreditItem, BillPaymentLineItem } from '../../types';
import type { QBAccount } from '../types/qb';

const PAY_TYPES = ['Cash', 'Check', 'CreditCard', 'Other'] as const;
type PayType = (typeof PAY_TYPES)[number];

function toYMD(date: Date): string {
  return date.toISOString().split('T')[0];
}

interface Props {
  jwt: string;
  selectedLocationId: string;
}

export default function BillPaymentView({ jwt, selectedLocationId }: Props) {
  const { status, connect } = useQuickBooks(jwt);
  const { accounts, vendors, listsLoaded, listsLoading, listsError, syncAllLists } = useQBContext();

  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(toYMD(new Date()));
  const [payType, setPayType] = useState<PayType>('Check');
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [checkNum, setCheckNum] = useState<string>('');
  const [bills, setBills] = useState<Array<OutstandingBill & { selected: boolean; paymentAmount: number }>>([]);
  const [credits, setCredits] = useState<Array<VendorCreditItem & { selected: boolean; applyAmount: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ billPaymentId: string; totalAmount: number; txnDate: string } | null>(null);

  const selectedVendor = vendors.find((vendor) => vendor.Id === selectedVendorId);
  const bankAccounts = useMemo(
    () => accounts.filter((account) => account.Active && account.AccountType === 'Bank'),
    [accounts],
  );

  const vendorOptions = useMemo(
    () => vendors
      .filter((vendor) => vendor.Active)
      .map((vendor) => ({ value: vendor.Id, label: vendor.DisplayName, subtitle: vendor.CompanyName ?? undefined })),
    [vendors],
  );

  const bankAccountOptions = useMemo(
    () => bankAccounts.map((account) => ({ value: account.Id, label: account.FullyQualifiedName, subtitle: account.AccountSubType })),
    [bankAccounts],
  );

  useEffect(() => {
    if (!selectedVendorId) {
      setBills([]);
      setCredits([]);
      setError(null);
      setSuccess(null);
      setBankAccountId('');
      setCheckNum('');
      return;
    }

    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      setSuccess(null);
      setBills([]);
      setCredits([]);

      try {
        const [billsRes, creditsRes] = await Promise.all([
          api.getOutstandingBills(jwt, selectedVendorId),
          api.getVendorCredits(jwt, selectedVendorId),
        ]);

        if (!active) return;

        setBills(
          billsRes.bills.map((bill) => ({
            ...bill,
            selected: false,
            paymentAmount: 0,
          })),
        );
        setCredits(
          creditsRes.vendorCredits.map((credit) => ({
            ...credit,
            selected: false,
            applyAmount: 0,
          })),
        );
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load bills and credits');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [jwt, selectedVendorId]);

  useEffect(() => {
    if (payType === 'Cash' || payType === 'Other') {
      setBankAccountId('');
      setCheckNum('');
    }
    if (payType === 'CreditCard') {
      setCheckNum('');
    }
  }, [payType]);

  const totalBills = useMemo(
    () => bills.filter((bill) => bill.selected).reduce((sum, bill) => sum + bill.paymentAmount, 0),
    [bills],
  );

  const totalCredits = useMemo(
    () => credits.filter((credit) => credit.selected).reduce((sum, credit) => sum + credit.applyAmount, 0),
    [credits],
  );

  const netPaymentAmount = useMemo(() => Math.max(0, totalBills - totalCredits), [totalBills, totalCredits]);

  const handleSelectAllBills = useCallback(() => {
    setBills((prev) => prev.map((bill) => ({ ...bill, selected: true, paymentAmount: bill.balance })));
  }, []);

  const handleDeselectAllBills = useCallback(() => {
    setBills((prev) => prev.map((bill) => ({ ...bill, selected: false, paymentAmount: 0 })));
  }, []);

  const handleApplyAllCredits = useCallback(() => {
    setCredits((prev) => prev.map((credit) => ({ ...credit, selected: true, applyAmount: credit.balance })));
  }, []);

  const handleClearAllCredits = useCallback(() => {
    setCredits((prev) => prev.map((credit) => ({ ...credit, selected: false, applyAmount: 0 })));
  }, []);

  const updateBillSelection = useCallback((id: string, selected: boolean) => {
    setBills((prev) => prev.map((bill) => ({
      ...bill,
      selected,
      paymentAmount: selected ? (bill.paymentAmount || bill.balance) : 0,
    })));
  }, []);

  const updateBillAmount = useCallback((id: string, value: number) => {
    setBills((prev) => prev.map((bill) => {
      if (bill.id !== id) return bill;
      return {
        ...bill,
        paymentAmount: Math.max(0, Math.min(bill.balance, Number.isNaN(value) ? 0 : value)),
        selected: value > 0,
      };
    }));
  }, []);

  const updateCreditSelection = useCallback((id: string, selected: boolean) => {
    setCredits((prev) => prev.map((credit) => ({
      ...credit,
      selected,
      applyAmount: selected ? (credit.applyAmount || credit.balance) : 0,
    })));
  }, []);

  const updateCreditAmount = useCallback((id: string, value: number) => {
    setCredits((prev) => prev.map((credit) => {
      if (credit.id !== id) return credit;
      return {
        ...credit,
        applyAmount: Math.max(0, Math.min(credit.balance, Number.isNaN(value) ? 0 : value)),
        selected: value > 0,
      };
    }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedVendor) {
      setError('Vendor is required');
      return;
    }

    if (payType !== 'Cash' && payType !== 'Other' && !bankAccountId) {
      setError('Bank account is required for this payment type');
      return;
    }

    const selectedBills = bills.filter((bill) => bill.selected && bill.paymentAmount > 0);
    if (selectedBills.length === 0) {
      setError('At least one bill must be selected');
      return;
    }

    if (netPaymentAmount <= 0) {
      setError('Net payment amount must be greater than zero');
      return;
    }

    const lines: BillPaymentLineItem[] = [
      ...selectedBills.map<BillPaymentLineItem>((bill) => ({
        amount: bill.paymentAmount,
        linkedTxn: {
          txnId: bill.id,
          txnType: 'Bill',
        },
      })),
      ...credits.filter((credit) => credit.selected && credit.applyAmount > 0).map<BillPaymentLineItem>((credit) => ({
        amount: credit.applyAmount,
        linkedTxn: {
          txnId: credit.id,
          txnType: 'VendorCredit',
        },
      })),
    ];

    const bankAccountRef = bankAccountId
      ? bankAccounts.find((account) => account.Id === bankAccountId)
      : undefined;

    if ((payType === 'Check' || payType === 'CreditCard') && !bankAccountRef) {
      setError('Bank account is required for this payment type');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await api.createBillPayment(
        jwt,
        { value: selectedVendor.Id, name: selectedVendor.DisplayName },
        payType,
        paymentDate,
        netPaymentAmount,
        lines,
        bankAccountRef ? { value: bankAccountRef.Id, name: bankAccountRef.FullyQualifiedName } : undefined,
        checkNum || undefined,
      );

      setSuccess({ billPaymentId: result.billPaymentId, totalAmount: result.totalAmount, txnDate: result.txnDate });
      setError(null);
      setBills((prev) => prev.map((bill) => ({ ...bill, selected: false, paymentAmount: 0 })));
      setCredits((prev) => prev.map((credit) => ({ ...credit, selected: false, applyAmount: 0 })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bill payment failed');
    } finally {
      setLoading(false);
    }
  }, [bankAccountId, bankAccounts, bills, checkNum, jwt, netPaymentAmount, paymentDate, payType, selectedVendor, credits]);

  if (!status.connected) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <div className="text-4xl mb-3">🔗</div>
        <p className="text-gray-400 text-sm mb-1">QuickBooks not connected</p>
        <p className="text-gray-600 text-xs mb-4">Connect QuickBooks in Settings to manage bill payments.</p>
        <button onClick={connect} className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-4 py-2 rounded-lg">
          Connect QuickBooks
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-4">
      <div className="flex items-center gap-2 text-xs px-3 py-1.5 bg-green-900/20 border border-green-800 rounded-lg">
        <span className="text-green-400">✅ QB Connected</span>
        <span className="text-gray-600 truncate">{status.realmId}</span>
        <button
          onClick={() => void syncAllLists()}
          disabled={listsLoading}
          className="ml-auto text-gray-500 hover:text-gray-300 transition-colors"
          title="Refresh QB lists"
        >
          {listsLoading ? '…' : '↻'}
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 grid gap-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">Vendor</div>
              <SearchableSelect
                options={vendorOptions}
                value={selectedVendorId}
                onChange={(value) => setSelectedVendorId(value)}
                placeholder="Select vendor…"
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Payment Date</div>
              <SmartDatePicker value={paymentDate} onChange={setPaymentDate} />
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">Payment Type</div>
              <select
                aria-label="Payment Type"
                className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
                value={payType}
                onChange={(event) => setPayType(event.target.value as PayType)}
              >
                {PAY_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            {(payType === 'Check' || payType === 'CreditCard') && (
              <div>
                <div className="text-xs text-gray-500 mb-1">Bank Account</div>
                <SearchableSelect
                  options={bankAccountOptions}
                  value={bankAccountId}
                  onChange={(value) => setBankAccountId(value)}
                  placeholder="Select bank account…"
                />
              </div>
            )}
            {payType === 'Check' && (
              <div>
                <div className="text-xs text-gray-500 mb-1">Check No.</div>
                <input
                  className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
                  value={checkNum}
                  onChange={(event) => setCheckNum(event.target.value)}
                  placeholder="Check number"
                />
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Summary</div>
          <div className="text-sm text-gray-200">Selected Bills: ${totalBills.toFixed(2)}</div>
          <div className="text-sm text-gray-200">Credits Applied: -${totalCredits.toFixed(2)}</div>
          <div className="text-lg font-semibold text-white">Net Payment: ${netPaymentAmount.toFixed(2)}</div>
          <div className="text-xs text-gray-500">Location: {selectedLocationId || 'Not selected'}</div>
        </div>
      </div>

      {loading && (
        <div className="px-3 py-2 text-xs text-gray-400">Loading bills and credits…</div>
      )}
      {error && (
        <div className="px-3 py-2 bg-red-900/30 border border-red-700 text-sm text-red-200 rounded-lg">{error}</div>
      )}
      {success && (
        <div className="px-3 py-2 bg-green-900/30 border border-green-700 text-sm text-green-200 rounded-lg">
          Bill Payment created successfully. ID: <span className="font-semibold text-white">{success.billPaymentId}</span> for <span className="font-semibold text-white">${success.totalAmount.toFixed(2)}</span> on {success.txnDate}.
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wider">Outstanding Bills</div>
            <p className="text-gray-500 text-xs">Select bills to pay and enter amounts.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSelectAllBills}
              className="text-xs bg-gray-800 border border-gray-700 px-3 py-1 rounded hover:bg-gray-700"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={handleDeselectAllBills}
              className="text-xs bg-gray-800 border border-gray-700 px-3 py-1 rounded hover:bg-gray-700"
            >
              Deselect All
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-900">
          <table className="min-w-full text-left text-sm text-gray-200">
            <thead className="bg-gray-800 text-xs uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-3 py-2">Pay</th>
                <th className="px-3 py-2">Bill No.</th>
                <th className="px-3 py-2">Bill Date</th>
                <th className="px-3 py-2">Due Date</th>
                <th className="px-3 py-2">Original</th>
                <th className="px-3 py-2">Open Balance</th>
                <th className="px-3 py-2">Payment</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => (
                <tr key={bill.id} className="border-t border-gray-800">
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      aria-label="Select bill to pay"
                      checked={bill.selected}
                      onChange={(event) => updateBillSelection(bill.id, event.target.checked)}
                      className="h-4 w-4 text-cyan-400 bg-gray-900 border-gray-700"
                    />
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-200">{bill.docNumber || bill.id}</td>
                  <td className="px-3 py-2 align-top text-xs text-gray-200">{bill.txnDate}</td>
                  <td className="px-3 py-2 align-top text-xs text-gray-200">{bill.dueDate || '—'}</td>
                  <td className="px-3 py-2 align-top text-xs text-gray-200">${bill.totalAmt.toFixed(2)}</td>
                  <td className="px-3 py-2 align-top text-xs text-gray-200">${bill.balance.toFixed(2)}</td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="number"
                      aria-label="Bill payment amount"
                      placeholder="0.00"
                      value={bill.paymentAmount.toFixed(2)}
                      min={0}
                      max={bill.balance}
                      step="0.01"
                      disabled={!bill.selected}
                      onChange={(event) => updateBillAmount(bill.id, parseFloat(event.target.value))}
                      className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-white"
                    />
                  </td>
                </tr>
              ))}
              {bills.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-xs text-gray-500">No outstanding bills found for this vendor.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {credits.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wider">Vendor Credits</div>
              <p className="text-gray-500 text-xs">Apply credits to reduce the payment amount.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleApplyAllCredits}
                className="text-xs bg-gray-800 border border-gray-700 px-3 py-1 rounded hover:bg-gray-700"
              >
                Apply All
              </button>
              <button
                type="button"
                onClick={handleClearAllCredits}
                className="text-xs bg-gray-800 border border-gray-700 px-3 py-1 rounded hover:bg-gray-700"
              >
                Clear All
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-900">
            <table className="min-w-full text-left text-sm text-gray-200">
              <thead className="bg-gray-800 text-xs uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="px-3 py-2">Apply</th>
                  <th className="px-3 py-2">Credit No.</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Original</th>
                  <th className="px-3 py-2">Open Balance</th>
                  <th className="px-3 py-2">Credit to Apply</th>
                </tr>
              </thead>
              <tbody>
                {credits.map((credit) => (
                  <tr key={credit.id} className="border-t border-gray-800">
                    <td className="px-3 py-2 align-top">
                      <input
                        type="checkbox"
                        aria-label="Select credit to apply"
                        checked={credit.selected}
                        onChange={(event) => updateCreditSelection(credit.id, event.target.checked)}
                        className="h-4 w-4 text-cyan-400 bg-gray-900 border-gray-700"
                      />
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-gray-200">{credit.docNumber || credit.id}</td>
                    <td className="px-3 py-2 align-top text-xs text-gray-200">{credit.txnDate}</td>
                    <td className="px-3 py-2 align-top text-xs text-gray-200">${credit.totalAmt.toFixed(2)}</td>
                    <td className="px-3 py-2 align-top text-xs text-gray-200">${credit.balance.toFixed(2)}</td>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="number"
                        aria-label="Credit apply amount"
                        placeholder="0.00"
                        value={credit.applyAmount.toFixed(2)}
                        min={0}
                        max={credit.balance}
                        step="0.01"
                        disabled={!credit.selected}
                        onChange={(event) => updateCreditAmount(credit.id, parseFloat(event.target.value))}
                        className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-white"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-gray-200">Net Payment: <span className="font-semibold text-white">${netPaymentAmount.toFixed(2)}</span></div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !selectedVendorId || netPaymentAmount <= 0 || ((payType === 'Check' || payType === 'CreditCard') && !bankAccountId)}
          className="rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Processing…' : 'Create Bill Payment'}
        </button>
      </div>
    </div>
  );
}
