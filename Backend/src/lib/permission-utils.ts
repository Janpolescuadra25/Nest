export function mergePermissions(
  existing: Record<string, boolean> | null,
  updates: Record<string, unknown>
): Record<string, boolean> {
  const result: Record<string, boolean> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(updates)) {
    if (key in result && typeof value === 'boolean') {
      result[key] = value;
    }
  }
  return result;
}
