import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export interface UserInfo {
  id: string;
  email: string;
  role: string;
  name: string | null;
  status: string;
  mustChangePassword: boolean;
  canScan: boolean;
  canMap: boolean;
  canSync: boolean;
  canManageLocs: boolean;
}

export function useAuth() {
  const [jwt, setJwt] = useState<string | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await Promise.race([
          new Promise<{ jwt?: string }>((resolve) => {
            chrome.storage.local.get(['jwt'], (items) => resolve(items as { jwt?: string }));
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Storage timeout')), 5000)
          ),
        ]);
        if (result.jwt) {
          setJwt(result.jwt);
          try {
            const session = await api.getSession(result.jwt);
            setUser(session.user);
          } catch {
            await chrome.storage.local.remove('jwt');
            setJwt(null);
          }
        }
      } catch {
        // Timeout or other error
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (userData: UserInfo, token: string) => {
    setJwt(token);
    setUser(userData);
    await chrome.storage.local.set({ jwt: token });
  }, []);

  const logout = useCallback(async () => {
    setJwt(null);
    setUser(null);
    await chrome.storage.local.remove('jwt');
  }, []);

  return { jwt, user, loading, login, logout };
}
