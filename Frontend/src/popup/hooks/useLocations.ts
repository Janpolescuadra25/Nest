import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { Location } from '../../types';

export function useLocations(jwt: string | null) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!jwt) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getLocations(jwt);
      setLocations(Array.isArray(res.data) ? res.data : Array.isArray(res as any) ? (res as any) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load locations');
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { locations, loading, error, refetch };
}
