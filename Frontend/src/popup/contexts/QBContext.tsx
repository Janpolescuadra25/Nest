import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import type {
  QBAccount, QBClass, QBEmployee, QBVendor, QBCustomer, QBTaxCode, QBEntity,
} from '../types/qb';

interface QBContextType {
  accounts: QBAccount[];
  classes: QBClass[];
  employees: QBEmployee[];
  vendors: QBVendor[];
  customers: QBCustomer[];
  taxCodes: QBTaxCode[];
  listsLoaded: boolean;
  listsLoading: boolean;
  syncAllLists: () => Promise<void>;
  getAccountById: (id: string) => QBAccount | undefined;
  getClassById: (id: string) => QBClass | undefined;
  searchAccounts: (query: string) => QBAccount[];
  searchEntities: (query: string) => QBEntity[];
}

const QBContext = createContext<QBContextType | null>(null);

export function QBContextProvider({
  jwt,
  children,
}: {
  jwt: string | null;
  children: React.ReactNode;
}) {
  const [accounts, setAccounts] = useState<QBAccount[]>([]);
  const [classes, setClasses] = useState<QBClass[]>([]);
  const [employees, setEmployees] = useState<QBEmployee[]>([]);
  const [vendors, setVendors] = useState<QBVendor[]>([]);
  const [customers, setCustomers] = useState<QBCustomer[]>([]);
  const [taxCodes, setTaxCodes] = useState<QBTaxCode[]>([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [listsLoading, setListsLoading] = useState(false);
  const listsLoadingRef = useRef(false);

  const syncAllLists = useCallback(async () => {
    if (!jwt || listsLoadingRef.current) return;
    listsLoadingRef.current = true;
    console.log('[QBContext] syncAllLists called, jwt present:', !!jwt);
    setListsLoading(true);
    try {
      const data = await api.syncQBAll(jwt);
      console.log('[QBContext] syncAllLists received:', {
        accounts: data.accounts?.length ?? 0,
        classes: data.classes?.length ?? 0,
        employees: data.employees?.length ?? 0,
        vendors: data.vendors?.length ?? 0,
        customers: data.customers?.length ?? 0,
        taxCodes: data.taxCodes?.length ?? 0,
      });
      setAccounts(data.accounts ?? []);
      setClasses(data.classes ?? []);
      setEmployees(data.employees ?? []);
      setVendors(data.vendors ?? []);
      setCustomers(data.customers ?? []);
      setTaxCodes(data.taxCodes ?? []);
      setListsLoaded(true);
    } catch (err) {
      console.error('[QBContext] syncAllLists error:', err);
    } finally {
      listsLoadingRef.current = false;
      setListsLoading(false);
    }
  }, [jwt]);

  const getAccountById = useCallback(
    (id: string) => accounts.find((a) => a.Id === id),
    [accounts],
  );

  const getClassById = useCallback(
    (id: string) => classes.find((c) => c.Id === id),
    [classes],
  );

  const searchAccounts = useCallback(
    (query: string) => {
      const q = query.toLowerCase();
      return accounts.filter(
        (a) =>
          a.Active &&
          (a.FullyQualifiedName.toLowerCase().includes(q) ||
            a.AccountSubType.toLowerCase().includes(q)),
      );
    },
    [accounts],
  );

  const searchEntities = useCallback(
    (query: string): QBEntity[] => {
      const q = query.toLowerCase();
      const results: QBEntity[] = [];
      customers
        .filter((c) => c.Active && c.DisplayName.toLowerCase().includes(q))
        .forEach((c) => results.push({ type: 'customer', id: c.Id, displayName: c.DisplayName }));
      vendors
        .filter((v) => v.Active && v.DisplayName.toLowerCase().includes(q))
        .forEach((v) => results.push({ type: 'vendor', id: v.Id, displayName: v.DisplayName }));
      employees
        .filter((e) => e.Active && e.DisplayName.toLowerCase().includes(q))
        .forEach((e) =>
          results.push({ type: 'employee', id: e.Id, displayName: e.DisplayName }),
        );
      return results;
    },
    [customers, vendors, employees],
  );

  return (
    <QBContext.Provider
      value={{
        accounts,
        classes,
        employees,
        vendors,
        customers,
        taxCodes,
        listsLoaded,
        listsLoading,
        syncAllLists,
        getAccountById,
        getClassById,
        searchAccounts,
        searchEntities,
      }}
    >
      {children}
    </QBContext.Provider>
  );
}

export function useQBContext(): QBContextType {
  const ctx = useContext(QBContext);
  if (!ctx) throw new Error('useQBContext must be used within QBContextProvider');
  return ctx;
}
