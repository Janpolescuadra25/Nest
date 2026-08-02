export interface PreSyncCheck {
  passed: boolean;
  label: string;
  detail?: string;
}

interface PreSyncChecklistProps {
  checks: PreSyncCheck[];
}

export default function PreSyncChecklist({ checks }: PreSyncChecklistProps) {
  if (checks.length === 0) return null;

  const allPassed = checks.every((c) => c.passed);

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-xs space-y-1 ${
        allPassed
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : 'bg-amber-50 border-amber-200 text-amber-700'
      }`}
    >
      <div className="font-semibold">
        {allPassed ? '✅ Ready to sync' : '⚠️ Review before syncing'}
      </div>
      <div className="space-y-0.5 pl-1">
        {checks.map((check, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span>{check.passed ? '✅' : '⚠️'}</span>
            <span>{check.label}</span>
            {check.detail && (
              <span className="text-stone-500">— {check.detail}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
