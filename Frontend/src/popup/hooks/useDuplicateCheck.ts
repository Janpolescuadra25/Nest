import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { DuplicateCheckResult } from '../../types';

export function useDuplicateCheck(
  jwt: string | null,
  syncType: string,
  payload: Record<string, unknown> | null,
): DuplicateCheckResult | null {
  const [result, setResult] = useState<DuplicateCheckResult | null>(null);

  const payloadJson = useMemo(
    () => (payload ? JSON.stringify(payload) : null),
    [payload],
  );

  useEffect(() => {
    if (!payloadJson || !jwt) {
      setResult(null);
      return;
    }
    let cancelled = false;
    api
      .checkDuplicate(jwt, syncType, JSON.parse(payloadJson))
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        if (!cancelled) setResult(null);
      });
    return () => {
      cancelled = true;
    };
  }, [payloadJson, jwt, syncType]);

  return result;
}
