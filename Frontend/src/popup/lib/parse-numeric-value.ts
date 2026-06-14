export function parseNumericValue(raw: unknown): number {
  const value = String(raw).replace(/[^0-9.-]/g, '').trim();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
