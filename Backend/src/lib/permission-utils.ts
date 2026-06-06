export function mergePermissions(
  existing: Record<string, boolean> | null,
  updates: Record<string, boolean>
): Record<string, boolean> {
  return { ...(existing ?? {}), ...updates };
}
