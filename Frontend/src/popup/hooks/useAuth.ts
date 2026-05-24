import { useState, useEffect, useCallback } from 'react';

export function useAuth() {
  const [jwt, setJwtState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.storage.local.get(['jwt'], (result) => {
      const stored = result['jwt'] as string | undefined;
      if (stored) {
        try {
          const parts = stored.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1])) as { exp?: number };
            if (payload.exp && payload.exp * 1000 > Date.now()) {
              setJwtState(stored);
            } else {
              chrome.storage.local.remove(['jwt']);
            }
          }
        } catch {
          chrome.storage.local.remove(['jwt']);
        }
      }
      setLoading(false);
    });
  }, []);

  const setJwt = useCallback((token: string | null) => {
    if (token) {
      chrome.storage.local.set({ jwt: token });
    } else {
      chrome.storage.local.remove(['jwt']);
    }
    setJwtState(token);
  }, []);

  return { jwt, setJwt, loading };
}
