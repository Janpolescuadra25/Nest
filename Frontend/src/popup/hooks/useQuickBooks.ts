import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { QBStatus } from '../../types';

export function useQuickBooks(jwt: string | null) {
  const [status, setStatus] = useState<QBStatus>({ connected: false });
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const checkStatus = useCallback(async (signal?: { cancelled: boolean }) => {
    if (!jwt) return;
    setLoading(true);
    try {
      const s = await api.getQBStatus(jwt);
      if (!signal?.cancelled) setStatus(s);
    } catch {
      if (!signal?.cancelled) setStatus({ connected: false });
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, [jwt]);

  useEffect(() => {
    const signal = { cancelled: false };
    void checkStatus(signal);
    return () => { signal.cancelled = true; };
  }, [checkStatus]);

  const connect = useCallback(async () => {
    if (!jwt) return;
    setAuthError(null);
    try {
      const { authUrl } = await api.getQBAuthUrl(jwt);
      // Ask background to open the auth URL in a new tab
      chrome.runtime.sendMessage({ type: 'OPEN_QB_AUTH', payload: { authUrl } });
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error('[QB] Failed to get auth URL:', err);
    }
  }, [jwt]);

  useEffect(() => {
    const listener = (message: any) => {
      if (message?.type !== 'QB_AUTH_CALLBACK') return;
      const { success, error } = message.payload ?? {};
      if (success) {
        setAuthError(null);
        void checkStatus();
      } else {
        setAuthError(error ?? 'QuickBooks authorization failed.');
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [checkStatus]);

  return { status, loading, connect, checkStatus, authError };
}
