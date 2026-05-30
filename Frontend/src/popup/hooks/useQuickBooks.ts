import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { QBStatus } from '../../types';

export function useQuickBooks(jwt: string | null) {
  const [status, setStatus] = useState<QBStatus>({ connected: false });
  const [loading, setLoading] = useState(false);

  const checkStatus = useCallback(async () => {
    if (!jwt) return;
    setLoading(true);
    try {
      const s = await api.getQBStatus(jwt);
      setStatus(s);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const connect = useCallback(async () => {
    if (!jwt) return;
    try {
      const { authUrl } = await api.getQBAuthUrl(jwt);
      // Ask background to open the auth URL in a new tab
      chrome.runtime.sendMessage({ type: 'OPEN_QB_AUTH', payload: { authUrl } });
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error('[QB] Failed to get auth URL:', err);
    }
  }, [jwt]);

  return { status, loading, connect, checkStatus };
}
