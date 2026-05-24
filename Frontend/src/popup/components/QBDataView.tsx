import React, { useState, useMemo, useEffect } from 'react';
import { useQBContext } from '../contexts/QBContext';

const CLASS_COLORS: Record<string, string> = {
  Asset: 'text-blue-400',
  Liability: 'text-red-400',
  Equity: 'text-purple-400',
  Revenue: 'text-green-400',
  Expense: 'text-orange-400',
};

export default function QBDataView() {
  const {
    accounts, customers, vendors, employees, taxCodes, classes,
    listsLoaded, listsLoading, syncAllLists,
  } = useQBContext();

  const [openSection, setOpenSection] = useState<string>('accounts');
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [classFilter, setClassFilter] = useState('');

  // Auto-trigger sync when tab is opened
  useEffect(() => {
    if (!listsLoaded && !listsLoading) void syncAllLists();
  }, [listsLoaded, listsLoading, syncAllLists]);

  const setSearch = (key: string, val: string) =>
    setSearches((prev) => ({ ...prev, [key]: val }));
  const getSearch = (key: string) => searches[key] ?? '';

  const classifiers = useMemo(
    () => [...new Set(accounts.map((a) => a.Classification).filter(Boolean))].sort() as string[],
    [accounts],
  );

  const filteredAccounts = useMemo(() => {
    let list = accounts;
    if (classFilter) list = list.filter((a) => a.Classification === classFilter);
    const q = getSearch('accounts').toLowerCase();
    if (q) list = list.filter((a) => a.FullyQualifiedName.toLowerCase().includes(q));
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, classFilter, searches]);

  const filteredCustomers = useMemo(() => {
    const q = getSearch('customers').toLowerCase();
    return q ? customers.filter((c) => c.DisplayName.toLowerCase().includes(q)) : customers;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, searches]);

  const filteredVendors = useMemo(() => {
    const q = getSearch('vendors').toLowerCase();
    return q ? vendors.filter((v) => v.DisplayName.toLowerCase().includes(q)) : vendors;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendors, searches]);

  const filteredEmployees = useMemo(() => {
    const q = getSearch('employees').toLowerCase();
    return q ? employees.filter((e) => e.DisplayName.toLowerCase().includes(q)) : employees;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, searches]);

  const filteredTaxCodes = useMemo(() => {
    const q = getSearch('taxCodes').toLowerCase();
    return q ? taxCodes.filter((t) => t.Name.toLowerCase().includes(q)) : taxCodes;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxCodes, searches]);

  const filteredClasses = useMemo(() => {
    const q = getSearch('classes').toLowerCase();
    return q ? classes.filter((c) => c.FullyQualifiedName.toLowerCase().includes(q)) : classes;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes, searches]);

  const counts: Record<string, number> = {
    accounts: accounts.length,
    customers: customers.length,
    vendors: vendors.length,
    employees: employees.length,
    taxCodes: taxCodes.length,
    classes: classes.length,
  };

  const SECTIONS = [
    { key: 'accounts', label: 'Accounts', icon: '📊' },
    { key: 'customers', label: 'Customers', icon: '👥' },
    { key: 'vendors', label: 'Vendors', icon: '🏢' },
    { key: 'employees', label: 'Employees', icon: '👤' },
    { key: 'taxCodes', label: 'Tax Codes', icon: '🧾' },
    { key: 'classes', label: 'Classes', icon: '🏷️' },
  ];

  if (listsLoading) {
    return (
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-400 animate-pulse">Loading QuickBooks data…</span>
        </div>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!listsLoaded) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <div className="text-4xl mb-3">📊</div>
        <p className="text-gray-400 text-sm mb-3">Failed to load QB data</p>
        <p className="text-gray-600 text-xs mb-4">Make sure QuickBooks is connected in Settings</p>
        <button
          onClick={() => void syncAllLists()}
          className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-4 py-2 rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white">QuickBooks Data</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {counts.accounts} accounts · {counts.customers} customers · {counts.vendors} vendors ·{' '}
            {counts.employees} employees
          </div>
        </div>
        <button
          onClick={() => void syncAllLists()}
          disabled={listsLoading}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 px-2.5 py-1.5 rounded transition-colors disabled:opacity-50"
        >
          {listsLoading ? '…' : '↻'} Refresh All
        </button>
      </div>

      {/* Sections */}
      {SECTIONS.map((section) => {
        const isOpen = openSection === section.key;
        const count = counts[section.key] ?? 0;

        return (
          <div key={section.key} className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenSection(isOpen ? '' : section.key)}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-700/50 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm text-gray-200">
                <span>{section.icon}</span>
                <span className="font-medium">{section.label}</span>
                <span className="text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded-full">{count}</span>
              </span>
              <span className="text-gray-500 text-xs">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="border-t border-gray-700/60">
                {/* Search + filter row */}
                <div className="px-3 py-2 flex gap-2">
                  <input
                    className="flex-1 bg-gray-900 border border-gray-700 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
                    placeholder={`Search ${section.label.toLowerCase()}…`}
                    value={getSearch(section.key)}
                    onChange={(e) => setSearch(section.key, e.target.value)}
                  />
                  {section.key === 'accounts' && (
                    <select
                      className="bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
                      value={classFilter}
                      onChange={(e) => setClassFilter(e.target.value)}
                    >
                      <option value="">All Types</option>
                      {classifiers.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                </div>

                {/* Table */}
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-gray-700">
                      {section.key === 'accounts' && (
                        <tr>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Name</th>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Sub-Type</th>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Classification</th>
                          <th className="text-right px-2 py-1.5 text-gray-400 font-medium">Balance</th>
                          <th className="text-center px-2 py-1.5 text-gray-400 font-medium">Active</th>
                        </tr>
                      )}
                      {section.key === 'customers' && (
                        <tr>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Name</th>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Company</th>
                          <th className="text-right px-2 py-1.5 text-gray-400 font-medium">Balance</th>
                          <th className="text-center px-2 py-1.5 text-gray-400 font-medium">Active</th>
                        </tr>
                      )}
                      {section.key === 'vendors' && (
                        <tr>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Name</th>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Company</th>
                          <th className="text-right px-2 py-1.5 text-gray-400 font-medium">Balance</th>
                          <th className="text-center px-2 py-1.5 text-gray-400 font-medium">Active</th>
                        </tr>
                      )}
                      {section.key === 'employees' && (
                        <tr>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Display Name</th>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">First</th>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Last</th>
                          <th className="text-center px-2 py-1.5 text-gray-400 font-medium">Status</th>
                          <th className="text-center px-2 py-1.5 text-gray-400 font-medium">Active</th>
                        </tr>
                      )}
                      {section.key === 'taxCodes' && (
                        <tr>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Name</th>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Description</th>
                          <th className="text-center px-2 py-1.5 text-gray-400 font-medium">Taxable</th>
                          <th className="text-center px-2 py-1.5 text-gray-400 font-medium">Active</th>
                        </tr>
                      )}
                      {section.key === 'classes' && (
                        <tr>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Name</th>
                          <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Full Name</th>
                          <th className="text-center px-2 py-1.5 text-gray-400 font-medium">Sub-Class</th>
                          <th className="text-center px-2 py-1.5 text-gray-400 font-medium">Active</th>
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {section.key === 'accounts' && filteredAccounts.map((a) => (
                        <tr key={a.Id} className="border-t border-gray-700/50 hover:bg-gray-700/30">
                          <td className="px-2 py-1 text-gray-200 max-w-xs truncate">{a.FullyQualifiedName}</td>
                          <td className="px-2 py-1 text-gray-400">{a.AccountSubType ?? a.AccountType}</td>
                          <td className={`px-2 py-1 font-medium ${CLASS_COLORS[a.Classification ?? ''] ?? 'text-gray-400'}`}>
                            {a.Classification}
                          </td>
                          <td className="px-2 py-1 text-right font-mono text-gray-300">
                            {a.CurrentBalance != null ? `$${a.CurrentBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                          </td>
                          <td className="px-2 py-1 text-center">{a.Active ? '✅' : '❌'}</td>
                        </tr>
                      ))}

                      {section.key === 'customers' && filteredCustomers.map((c) => (
                        <tr key={c.Id} className="border-t border-gray-700/50 hover:bg-gray-700/30">
                          <td className="px-2 py-1 text-gray-200">{c.DisplayName}</td>
                          <td className="px-2 py-1 text-gray-400">{c.CompanyName ?? '—'}</td>
                          <td className="px-2 py-1 text-right font-mono text-gray-300">
                            {c.Balance != null ? `$${c.Balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                          </td>
                          <td className="px-2 py-1 text-center">{c.Active ? '✅' : '❌'}</td>
                        </tr>
                      ))}

                      {section.key === 'vendors' && filteredVendors.map((v) => (
                        <tr key={v.Id} className="border-t border-gray-700/50 hover:bg-gray-700/30">
                          <td className="px-2 py-1 text-gray-200">{v.DisplayName}</td>
                          <td className="px-2 py-1 text-gray-400">{v.CompanyName ?? '—'}</td>
                          <td className="px-2 py-1 text-right font-mono text-gray-300">
                            {v.Balance != null ? `$${v.Balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                          </td>
                          <td className="px-2 py-1 text-center">{v.Active ? '✅' : '❌'}</td>
                        </tr>
                      ))}

                      {section.key === 'employees' && filteredEmployees.map((e) => (
                        <tr key={e.Id} className="border-t border-gray-700/50 hover:bg-gray-700/30">
                          <td className="px-2 py-1 text-gray-200">{e.DisplayName}</td>
                          <td className="px-2 py-1 text-gray-400">{e.GivenName ?? '—'}</td>
                          <td className="px-2 py-1 text-gray-400">{e.FamilyName ?? '—'}</td>
                          <td className="px-2 py-1 text-center text-gray-400">{e.Status ?? '—'}</td>
                          <td className="px-2 py-1 text-center">{e.Active ? '✅' : '❌'}</td>
                        </tr>
                      ))}

                      {section.key === 'taxCodes' && filteredTaxCodes.map((t) => (
                        <tr key={t.Id} className="border-t border-gray-700/50 hover:bg-gray-700/30">
                          <td className="px-2 py-1 text-gray-200">{t.Name}</td>
                          <td className="px-2 py-1 text-gray-400 truncate max-w-xs">{t.Description ?? '—'}</td>
                          <td className="px-2 py-1 text-center">{t.Taxable ? '✅' : '—'}</td>
                          <td className="px-2 py-1 text-center">{t.Active ? '✅' : '❌'}</td>
                        </tr>
                      ))}

                      {section.key === 'classes' && filteredClasses.map((c) => (
                        <tr key={c.Id} className="border-t border-gray-700/50 hover:bg-gray-700/30">
                          <td className="px-2 py-1 text-gray-200">{c.Name}</td>
                          <td className="px-2 py-1 text-gray-400">{c.FullyQualifiedName}</td>
                          <td className="px-2 py-1 text-center text-gray-400">{c.SubClass ? '✅' : '—'}</td>
                          <td className="px-2 py-1 text-center">{c.Active ? '✅' : '❌'}</td>
                        </tr>
                      ))}

                      {/* Empty state */}
                      {section.key === 'accounts' && filteredAccounts.length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-600">No accounts found</td></tr>
                      )}
                      {section.key === 'customers' && filteredCustomers.length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-600">No customers found</td></tr>
                      )}
                      {section.key === 'vendors' && filteredVendors.length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-600">No vendors found</td></tr>
                      )}
                      {section.key === 'employees' && filteredEmployees.length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-600">No employees found</td></tr>
                      )}
                      {section.key === 'taxCodes' && filteredTaxCodes.length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-600">No tax codes found</td></tr>
                      )}
                      {section.key === 'classes' && filteredClasses.length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-600">No classes found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
