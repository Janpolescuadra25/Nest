
# Phase 10 — Template Export/Import

**Context:** Users need to transfer a location's complete configuration (mappings + rules + memo/doc templates) to another location — within the same account or across accounts. This phase adds Export (download JSON) and Import (upload JSON) functionality. Same QB company is the MVP scope. Cross-company transfers get a warning but aren't blocked.

**Rules:**
1. Read all files fully before making changes.
2. After ALL fixes, run `cd Backend && npx prisma generate`, then `cd Frontend && npx tsc --noEmit` AND `cd Frontend && npm run build` to verify zero errors.
3. Do NOT use `as any` to bypass type errors.
4. Commit message: `feat: add template export/import for location configurations`

---

## FIX 1 — Backend: New import endpoint

**File:** `Backend/src/routes/locations.ts`

Add a new route **after** the existing DELETE handler (line 135) and **before** the GET /:id/mappings handler (line 137). This endpoint accepts a template JSON, validates it, and creates all records in a single Prisma transaction.

### Route: `POST /api/locations/:id/import-template`

```typescript
// ── POST /api/locations/:id/import-template ──────────────────────────────────
router.post('/:id/import-template', requirePermission('canMap'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const lf = locationFilter(req.user!);

    // Verify location exists and user has access
    const location = await prisma.location.findFirst({
      where: { id, ...lf },
    });
    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const body = req.body as {
      mappings?: Array<Record<string, unknown>>;
      rules?: Array<Record<string, unknown>>;
      memoTemplate?: string;
      docNumberTemplate?: string;
      mode?: 'replace' | 'merge';
    };

    const mode = body.mode || 'merge';

    // Validate structure — reject if no data at all (empty arrays count as nothing)
    if (!body.mappings?.length && !body.rules?.length && body.memoTemplate === undefined && body.docNumberTemplate === undefined) {
      res.status(400).json({ error: 'No template data provided' });
      return;
    }
    if (body.mappings && !Array.isArray(body.mappings)) {
      res.status(400).json({ error: 'mappings must be an array' });
      return;
    }
    if (body.rules && !Array.isArray(body.rules)) {
      res.status(400).json({ error: 'rules must be an array' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      let createdMappings = 0;
      let createdRules = 0;

      // Handle mappings
      if (body.mappings && body.mappings.length > 0) {
        if (mode === 'replace') {
          await tx.mapping.deleteMany({ where: { locationId: id } });
        }
        for (const m of body.mappings) {
          const sf = String(m.sourceField ?? '');
          const ta = String(m.targetAccount ?? '');
          if (!sf || !ta) continue; // skip invalid mappings
          await tx.mapping.create({
            data: {
              locationId: id,
              sourceField: sf,
              targetAccount: ta,
              postingType: m.postingType === 'Debit' ? 'Debit' : 'Credit',
              keepSeparate: Boolean(m.keepSeparate),
              targetClass: m.targetClass ? String(m.targetClass) : null,
              targetName: m.targetName ? String(m.targetName) : null,
              targetDescription: m.targetDescription ? String(m.targetDescription) : null,
              targetMemo: m.targetMemo ? String(m.targetMemo) : null,
              priority: Number(m.priority) || 0,
            },
          });
          createdMappings++;
        }
      } else if (mode === 'replace') {
        await tx.mapping.deleteMany({ where: { locationId: id } });
      }

      // Handle rules
      if (body.rules && body.rules.length > 0) {
        if (mode === 'replace') {
          await tx.rule.deleteMany({ where: { locationId: id } });
        }
        for (const r of body.rules) {
          const config = typeof r.config === 'object' && r.config !== null ? r.config as Record<string, unknown> : {};
          await tx.rule.create({
            data: {
              locationId: id,
              name: String(r.name ?? 'Imported rule'),
              ruleType: ['COMBINE', 'DEDUCT', 'THRESHOLD', 'FORMULA'].includes(String(r.ruleType))
                ? String(r.ruleType) as 'COMBINE' | 'DEDUCT' | 'THRESHOLD' | 'FORMULA'
                : 'COMBINE',
              config,
              isActive: r.isActive === false ? false : true,
            },
          });
          createdRules++;
        }
      } else if (mode === 'replace') {
        await tx.rule.deleteMany({ where: { locationId: id } });
      }

      // Handle templates
      if (body.memoTemplate !== undefined || body.docNumberTemplate !== undefined) {
        await tx.location.update({
          where: { id },
          data: {
            ...(body.memoTemplate !== undefined && { memoTemplate: body.memoTemplate || null }),
            ...(body.docNumberTemplate !== undefined && { docNumberTemplate: body.docNumberTemplate || null }),
          },
        });
      }

      return {
        success: true,
        createdMappings,
        createdRules,
        templatesUpdated: !!(body.memoTemplate || body.docNumberTemplate),
      };
    });

    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Import failed';
    console.error('[import-template]', message);
    res.status(500).json({
      error: process.env.NODE_ENV !== 'production'
        ? message
        : 'Template import failed. Please try again.',
    });
  }
});
```

**Key points:**
- Uses `requirePermission('canMap')` middleware — same as the existing mapping/rule creation routes (lines 163, 234). This is already imported at the top of the file.
- Uses `locationFilter(req.user!)` — already imported and used throughout the file. No dynamic import needed.
- Uses `prisma.$transaction` for atomicity — if any step fails, nothing is committed.
- `mode: 'replace'` deletes all existing mappings/rules before importing.
- `mode: 'merge'` (default) only adds new records, keeps existing.
- Each mapping is validated — skips entries with empty `sourceField` or `targetAccount` (matching the validation in the existing POST /:id/mappings route at line 181).
- Strips `id`, `locationId`, `createdAt`, `updatedAt` from imported data — only user-configurable fields are accepted.
- Empty string templates are stored as `null`.
- Error masking follows the existing pattern.

---

## FIX 2 — Frontend types: Export/Import types

**File:** `Frontend/src/types/index.ts`

Add after the existing `ExtMessage` interface (after line 145):

```typescript
export interface ExportTemplate {
  version: number;
  exportedAt: string;
  sourceLocationName: string;
  sourceRealmId: string;
  memoTemplate: string;
  docNumberTemplate: string;
  mappings: Array<{
    sourceField: string;
    targetAccount: string;
    postingType: string;
    keepSeparate: boolean;
    targetClass?: string;
    targetName?: string;
    targetDescription?: string;
    targetMemo?: string;
    priority: number;
  }>;
  rules: Array<{
    name: string;
    ruleType: string;
    config: Record<string, unknown>;
    isActive: boolean;
  }>;
}

export interface ImportResult {
  success: boolean;
  createdMappings: number;
  createdRules: number;
  templatesUpdated: boolean;
}
```

---

## FIX 3 — Frontend API: Import endpoint

**File:** `Frontend/src/popup/lib/api.ts`

### Step A: Add type import

Replace the existing import on line 1:

```typescript
import type { Location, Mapping, Rule, ScanData, QBStatus, ScanHealth, AuditLogEntry, OwnerAuditLogEntry, ExportTemplate, ImportResult } from '../../types';
```

### Step B: Add API function

Add this to the `api` object, after the existing `deleteRule` function (after line 205):

```typescript
  // ── Template Import ────────────────────────────────────────────────────────
  importTemplate: (jwt: string, locationId: string, data: Omit<ExportTemplate, 'version' | 'exportedAt' | 'sourceLocationName' | 'sourceRealmId'> & { mode: 'replace' | 'merge' }) =>
    post<ImportResult>(`/api/locations/${locationId}/import-template`, data, jwt),
```

**Note:** Export is purely frontend — no backend endpoint needed. The frontend builds the JSON from existing API data (`getMappings`, `getRules`, location data, QB status) and triggers a browser download.

---

## FIX 4 — MappingView: Add imports and hooks

**File:** `Frontend/src/popup/components/MappingView.tsx`

### Step A: Update imports

Replace line 1:

```typescript
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
```

Replace line 6:

```typescript
import type { Mapping, ScanData, TabId, ExportTemplate } from '../../types';
```

Add new imports after line 4 (`import { useQBContext } from '../contexts/QBContext';`):

```typescript
import { useQuickBooks } from '../hooks/useQuickBooks';
import { useToast } from './Toast';
```

### Step B: Add hooks inside MappingView

Inside the `MappingView` function body, after the existing `useQBContext()` destructure (after line 190), add:

```typescript
const { status: qbStatus } = useQuickBooks(jwt);
const { showToast } = useToast();
```

---

## FIX 5 — MappingView: Export handler

**File:** `Frontend/src/popup/components/MappingView.tsx`

Add this handler function after the `applyTemplate` function (after line 522):

```typescript
  const handleExport = useCallback(async () => {
    if (!locId || !jwt) return;
    try {
      const [mappings, rules] = await Promise.all([
        api.getMappings(jwt, locId),
        api.getRules(jwt, locId),
      ]);
      const loc = locations.find(l => l.id === locId);
      const exportData: ExportTemplate = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sourceLocationName: loc?.name ?? 'Unknown',
        sourceRealmId: qbStatus?.realmId ?? '',
        memoTemplate: memoTemplate,
        docNumberTemplate: docNumberTemplate,
        mappings: mappings.map(m => ({
          sourceField: m.sourceField,
          targetAccount: m.targetAccount,
          postingType: m.postingType ?? 'Credit',
          keepSeparate: m.keepSeparate ?? false,
          targetClass: m.targetClass ?? undefined,
          targetName: m.targetName ?? undefined,
          targetDescription: m.targetDescription ?? undefined,
          targetMemo: m.targetMemo ?? undefined,
          priority: m.priority,
        })),
        rules: rules.map(r => ({
          name: r.name,
          ruleType: r.ruleType,
          config: r.config as Record<string, unknown>,
          isActive: r.isActive,
        })),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nest-template-${(loc?.name ?? 'location').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Exported ${mappings.length} mappings + ${rules.length} rules`, 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Export failed', 'error');
    }
  }, [locId, jwt, locations, memoTemplate, docNumberTemplate, qbStatus, showToast]);
```

**Key points:**
- Uses `Promise.all` to fetch mappings + rules in parallel.
- Reads `realmId` from `qbStatus` which comes from the `useQuickBooks(jwt)` hook — already initialized and cached.
- Reads memo/doc templates from local state (already loaded from DB).
- Creates a JSON file with a descriptive filename.
- Uses the Blob + download link pattern (no server needed).
- Shows success/error toast via `useToast`.

---

## FIX 6 — MappingView: Import state and handlers

**File:** `Frontend/src/popup/components/MappingView.tsx`

### Step A: Add state for import

After the existing state declarations (after line 204, after `const saveTimerRef`), add:

```typescript
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge');
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [pendingImport, setPendingImport] = useState<ExportTemplate | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
```

### Step B: Add file change handler

After the `handleExport` function:

```typescript
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as ExportTemplate;
        // Validate structure
        if (!data.version || !data.mappings || !data.rules) {
          showToast('Invalid template file format', 'error');
          return;
        }
        if (data.version !== 1) {
          showToast('Unsupported template version', 'error');
          return;
        }
        // Check for cross-company warning
        const currentRealmId = qbStatus?.realmId;
        if (data.sourceRealmId && currentRealmId && data.sourceRealmId !== currentRealmId) {
          setImportWarning('This template was exported from a different QuickBooks company. Some account references may not match. Verify mappings after import.');
        } else {
          setImportWarning(null);
        }
        setPendingImport(data);
        setShowImportConfirm(true);
      } catch {
        showToast('Failed to read template file', 'error');
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  }, [showToast, qbStatus]);
```

### Step C: Add import confirmation handler

After `handleFileSelect`:

```typescript
  const handleImportConfirm = useCallback(async () => {
    if (!pendingImport || !locId || !jwt) return;
    try {
      const result = await api.importTemplate(jwt, locId, {
        mappings: pendingImport.mappings,
        rules: pendingImport.rules,
        memoTemplate: pendingImport.memoTemplate,
        docNumberTemplate: pendingImport.docNumberTemplate,
        mode: importMode,
      });
      showToast(`Imported ${result.createdMappings} mappings + ${result.createdRules} rules${result.templatesUpdated ? ' + templates' : ''}`, 'success');
      // Refresh mappings
      void loadMappings();
      // Refresh templates from location data — re-read from locations array
      const loc = locations.find(l => l.id === locId);
      if (loc) {
        setMemoTemplate(pendingImport.memoTemplate ?? loc.memoTemplate ?? '');
        setDocNumberTemplate(pendingImport.docNumberTemplate ?? loc.docNumberTemplate ?? '');
      }
      // Clear state
      setShowImportConfirm(false);
      setPendingImport(null);
      setImportWarning(null);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Import failed', 'error');
    }
  }, [pendingImport, locId, jwt, importMode, showToast, loadMappings, locations]);
```

**Key points:**
- Gets `currentRealmId` from `qbStatus?.realmId` — the `useQuickBooks` hook already fetches and caches QB status on mount.
- After import, calls `loadMappings()` to refresh the mapping list.
- After import, updates `memoTemplate`/`docNumberTemplate` local state from the imported data so the UI reflects immediately.
- Note: Rules are loaded independently in `RulesView` — when the user navigates to the Rules tab, `RulesView` will fetch fresh rules from the API, so no cross-component refresh is needed.

---

## FIX 7 — MappingView: Export/Import buttons in header

**File:** `Frontend/src/popup/components/MappingView.tsx`

In the header row (lines 546–563), add the Export and Import buttons alongside the existing location selector and "+ Add" button. Replace the entire header `<div className="flex items-center gap-2">` block (lines 546–563) with:

```tsx
      <div className="flex items-center gap-2">
        <select
          value={locId}
          onChange={(e) => onLocationChange(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
        >
          {locations.length === 0 && <option value="">No locations</option>}
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleExport}
          className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1.5 rounded border border-gray-600 whitespace-nowrap transition-colors"
          title="Export this location's configuration as a JSON file"
        >
          📤 Export
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1.5 rounded border border-gray-600 whitespace-nowrap transition-colors"
          title="Import a configuration template from a JSON file"
        >
          📥 Import
        </button>
        <button
          onClick={addMapping}
          className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-2 py-1.5 rounded whitespace-nowrap transition-colors"
        >
          + Add
        </button>
      </div>
```

---

## FIX 8 — MappingView: Hidden file input and Import confirmation modal

**File:** `Frontend/src/popup/components/MappingView.tsx`

### Step A: Add hidden file input

Add the hidden file input right after the header row div (after the closing `</div>` of the header), before the toolbar section:

```tsx
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileSelect}
      />
```

### Step B: Add Import confirmation modal

Add the confirmation modal right after the hidden file input. It should appear as an overlay when `showImportConfirm` is true:

```tsx
      {showImportConfirm && pendingImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-80 space-y-3">
            <h3 className="text-sm font-semibold text-white">Import Template</h3>
            <p className="text-xs text-gray-400">
              Import from: <span className="text-gray-200">{pendingImport.sourceLocationName || 'Unknown'}</span>
            </p>
            <div className="text-xs text-gray-400 space-y-1">
              <p>{pendingImport.mappings.length} mappings, {pendingImport.rules.length} rules</p>
              <p>Templates: {(pendingImport.memoTemplate || pendingImport.docNumberTemplate) ? 'Yes' : 'No'}</p>
            </div>
            {importWarning && (
              <div className="bg-orange-900/30 border border-orange-700 text-orange-300 text-xs rounded px-3 py-2">
                ⚠️ {importWarning}
              </div>
            )}
            <div className="space-y-2">
              <div className="text-xs text-gray-400">Mode:</div>
              <div className="flex gap-2">
                <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'merge'}
                    onChange={() => setImportMode('merge')}
                    className="accent-cyan-500"
                  />
                  Merge (add to existing)
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'replace'}
                    onChange={() => setImportMode('replace')}
                    className="accent-red-500"
                  />
                  Replace all
                </label>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowImportConfirm(false);
                  setPendingImport(null);
                  setImportWarning(null);
                }}
                className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleImportConfirm()}
                className="flex-1 text-xs bg-cyan-700 hover:bg-cyan-600 text-white py-2 rounded-lg transition-colors"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
```

---

## VERIFY

1. Read through all modified files to confirm consistency.
2. `cd Backend && npx prisma generate` — zero errors.
3. `cd Frontend && npx tsc --noEmit` — zero errors.
4. `cd Frontend && npm run build` — clean build.
5. Commit with message: `feat: add template export/import for location configurations`
