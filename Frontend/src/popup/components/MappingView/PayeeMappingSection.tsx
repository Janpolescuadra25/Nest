import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useQBContext } from '../../contexts/QBContext';
import SearchableSelect from '../SearchableSelect';
import { ConfirmDialog } from '../shared';
import { evaluateProductMatch } from '../../lib/column-extractor';
import type { PayeeMapping, PayeeMappingFormData, MatchingRule, MatchingRuleType } from '../../../types';

interface Props {
  jwt: string;
  templateId: string;
}

export default function PayeeMappingSection({ jwt, templateId }: Props) {
  const { vendors } = useQBContext();
  const [mappings, setMappings] = useState<PayeeMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingMapping, setEditingMapping] = useState<PayeeMapping | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState<PayeeMappingFormData>({ scannedName: '', vendorId: '' });
  const [useRuleEnabled, setUseRuleEnabled] = useState(false);
  const [ruleType, setRuleType] = useState<MatchingRuleType>('EXACT');
  const [ruleThreshold, setRuleThreshold] = useState(0.80);
  const [rulePattern, setRulePattern] = useState('');
  const [ruleDirection, setRuleDirection] = useState<'input_contains_catalog' | 'catalog_contains_input' | 'either'>('either');
  const [testInput, setTestInput] = useState('');
  const [testResults, setTestResults] = useState<{ mappingId: string; scannedName: string; matched: boolean; confidence: number; matchType: string }[]>([]);
  const [deleteMappingDialog, setDeleteMappingDialog] = useState<{ open: boolean; mapping: PayeeMapping | null }>({ open: false, mapping: null });

  const vendorOptions = useMemo(
    () => vendors.map((vendor) => ({ value: vendor.Id, label: vendor.DisplayName })),
    [vendors],
  );

  useEffect(() => {
    if (!templateId) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getPayeeMappings(jwt, templateId);
        setMappings(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load payee mappings');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [jwt, templateId]);

  useEffect(() => {
    setEditingMapping(null);
    setShowForm(false);
    setFormData({ scannedName: '', vendorId: '' });
    setUseRuleEnabled(false);
    setRuleType('EXACT');
    setRuleThreshold(0.80);
    setRulePattern('');
    setRuleDirection('either');
    setError(null);
  }, [templateId]);

  const resetForm = () => {
    setEditingMapping(null);
    setFormData({ scannedName: '', vendorId: '' });
    setUseRuleEnabled(false);
    setRuleType('EXACT');
    setRuleThreshold(0.80);
    setRulePattern('');
    setRuleDirection('either');
    setError(null);
  };

  const openAdd = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (mapping: PayeeMapping) => {
    setEditingMapping(mapping);
    setFormData({
      scannedName: mapping.scannedName,
      vendorId: mapping.vendorId,
      matchingRule: mapping.matchingRule ?? undefined,
    });
    if (mapping.matchingRule) {
      setUseRuleEnabled(true);
      setRuleType(mapping.matchingRule.type);
      setRuleThreshold(mapping.matchingRule.threshold ?? 0.80);
      setRulePattern(mapping.matchingRule.pattern ?? '');
      setRuleDirection(mapping.matchingRule.direction ?? 'either');
    } else {
      setUseRuleEnabled(false);
      setRuleType('EXACT');
      setRuleThreshold(0.80);
      setRulePattern('');
      setRuleDirection('either');
    }
    setError(null);
    setShowForm(true);
  };

  const handleCancel = () => {
    resetForm();
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!formData.scannedName.trim()) {
      setError('Scanned name is required');
      return;
    }
    if (!formData.vendorId) {
      setError('Vendor is required');
      return;
    }

    setSaving(true);
    setError(null);

    const matchingRule: MatchingRule | null = useRuleEnabled
      ? {
          type: ruleType,
          threshold: ruleThreshold,
          pattern: rulePattern || undefined,
          direction: ruleDirection,
          isActive: true,
        }
      : null;

    try {
      if (editingMapping) {
        const updated = await api.updatePayeeMapping(jwt, editingMapping.id, {
          scannedName: formData.scannedName.trim(),
          vendorId: formData.vendorId,
          matchingRule,
        });
        setMappings((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await api.createPayeeMapping(jwt, {
          templateId,
          scannedName: formData.scannedName.trim(),
          vendorId: formData.vendorId,
          matchingRule,
        });
        setMappings((prev) => [...prev, created].sort((a, b) => a.scannedName.localeCompare(b.scannedName)));
      }
      resetForm();
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save payee mapping');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (mapping: PayeeMapping) => {
    setDeleteMappingDialog({ open: true, mapping });
  };

  const confirmDeleteMapping = async () => {
    if (!deleteMappingDialog.mapping) return;
    const mapping = deleteMappingDialog.mapping;
    setDeleteMappingDialog({ open: false, mapping: null });

    try {
      await api.deletePayeeMapping(jwt, mapping.id);
      setMappings((prev) => prev.filter((item) => item.id !== mapping.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete payee mapping');
    }
  };

  const handleTestMatch = () => {
    if (!testInput.trim()) return;
    const results = mappings.map((mapping) => {
      const result = evaluateProductMatch(testInput.trim(), mapping.scannedName, mapping.matchingRule ?? undefined);
      return {
        mappingId: mapping.id,
        scannedName: mapping.scannedName,
        matched: result.matched,
        confidence: result.confidence,
        matchType: result.matchType,
      };
    }).sort((a, b) => b.confidence - a.confidence);
    setTestResults(results);
  };

  const vendorLabel = (id: string) => {
    const vendor = vendors.find((item) => item.Id === id);
    return vendor?.DisplayName || id;
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-100 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-600">
          ⚙️ Payee Mappings ({mappings.length})
        </span>
        <span className="text-gray-600 text-xs">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3">
          <p className="text-xs text-gray-600 mb-3">
            Configure known payee name mappings for cheque templates. This helps auto-select the correct vendor when a cheque is scanned.
          </p>

          <div className="rounded-xl border border-gray-200 bg-[#F5F5F7] p-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">🧾 Payee Mappings</h2>
                <p className="text-xs text-gray-600">Map scanned payee names to QuickBooks vendors.</p>
              </div>
              <button
                type="button"
                onClick={openAdd}
                className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-2"
              >
                + Add Mapping
              </button>
            </div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-300 rounded px-3 py-2">
                {error}
              </div>
            )}

            {loading ? (
              <div className="text-xs text-gray-600">Loading payee mappings…</div>
            ) : (
              <div className="space-y-4">
                {showForm && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs text-gray-600">Scanned Name</label>
                        <input
                          type="text"
                          value={formData.scannedName}
                          onChange={(e) => setFormData((prev) => ({ ...prev, scannedName: e.target.value }))}
                          className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Vendor</label>
                        <SearchableSelect
                          options={vendorOptions}
                          value={formData.vendorId}
                          onChange={(value) => setFormData((prev) => ({ ...prev, vendorId: value }))}
                          placeholder="Select vendor…"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-200">
                      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={useRuleEnabled} onChange={(e) => setUseRuleEnabled(e.target.checked)} className="rounded" />
                        Custom matching rule
                      </label>
                    </div>

                    {useRuleEnabled && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="text-xs text-gray-600">Rule Type</label>
                          <select
                            value={ruleType}
                            onChange={(e) => setRuleType(e.target.value as MatchingRuleType)}
                            className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                          >
                            <option value="EXACT">Exact Match</option>
                            <option value="CONTAINS">Contains</option>
                            <option value="STARTS_WITH">Starts With</option>
                            <option value="REGEX">Regex</option>
                          </select>
                        </div>

                        {(ruleType === 'CONTAINS' || ruleType === 'STARTS_WITH') && (
                          <div>
                            <label className="text-xs text-gray-600">Direction</label>
                            <select
                              value={ruleDirection}
                              onChange={(e) => setRuleDirection(e.target.value as any)}
                              className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                            >
                              <option value="either">Either direction</option>
                              <option value="input_contains_catalog">Input contains catalog</option>
                              <option value="catalog_contains_input">Catalog contains input</option>
                            </select>
                          </div>
                        )}

                        {ruleType === 'REGEX' && (
                          <div>
                            <label className="text-xs text-gray-600">Pattern</label>
                            <input
                              type="text"
                              value={rulePattern}
                              onChange={(e) => setRulePattern(e.target.value)}
                              placeholder="e.g. ^JONES PAYMENTS"
                              className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
                      <div className="text-sm font-semibold text-gray-900">Test Matcher</div>
                      <div className="text-xs text-gray-600">Type a scanned payee name to preview rule matching results.</div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={testInput}
                          onChange={(e) => setTestInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleTestMatch(); }}
                          placeholder="e.g. Acme Corp"
                          className="flex-1 rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleTestMatch}
                          disabled={!testInput.trim()}
                          className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Test
                        </button>
                      </div>
                      {testResults.length > 0 && (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {testResults.map((result) => (
                            <div key={result.mappingId} className="flex items-center justify-between text-xs rounded px-3 py-2 bg-[#F8F9FA]">
                              <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${result.matched ? 'bg-emerald-400' : 'bg-gray-400'}`} />
                                <span className="text-gray-700">{result.scannedName}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-gray-600">{result.matchType}</span>
                                <span className={`font-mono ${result.matched ? 'text-emerald-600' : 'text-gray-600'}`}>{(result.confidence * 100).toFixed(0)}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 justify-end">
                      <button
                        type="button"
                        onClick={handleCancel}
                        className="text-xs bg-white hover:bg-gray-100 text-gray-700 rounded px-3 py-2"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded px-3 py-2"
                      >
                        {saving ? 'Saving…' : editingMapping ? 'Save Changes' : 'Create Mapping'}
                      </button>
                    </div>
                  </div>
                )}

                {mappings.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
                    No payee mappings yet. Add one to auto-match scanned payee names.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-200 bg-[#F5F5F7]">
                    <table className="min-w-full text-left text-xs text-gray-700">
                      <thead>
                        <tr className="border-b border-gray-200 bg-white text-gray-600">
                          <th className="px-3 py-3">Scanned Name</th>
                          <th className="px-3 py-3">Vendor</th>
                          <th className="px-3 py-3">Match Rule</th>
                          <th className="px-3 py-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mappings.map((mapping) => (
                          <tr key={mapping.id} className="border-b border-gray-200 hover:bg-gray-50">
                            <td className="px-3 py-3 text-gray-700">{mapping.scannedName}</td>
                            <td className="px-3 py-3 text-gray-600">{vendorLabel(mapping.vendorId)}</td>
                            <td className="px-3 py-3">
                              {mapping.matchingRule ? (
                                <span className="inline-flex rounded px-2 py-0.5 bg-emerald-50 text-emerald-600 text-xs font-medium">
                                  {mapping.matchingRule.type}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-600">Default</span>
                              )}
                            </td>
                            <td className="px-3 py-3 space-x-2">
                              <button
                                type="button"
                                onClick={() => openEdit(mapping)}
                                className="text-xs text-emerald-500 hover:text-emerald-700"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(mapping)}
                                className="text-xs text-red-600 hover:text-red-700"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteMappingDialog.open}
        title="Delete Payee Mapping"
        message={`Delete payee mapping for "${deleteMappingDialog.mapping?.scannedName}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDeleteMapping}
        onCancel={() => setDeleteMappingDialog({ open: false, mapping: null })}
        variant="danger"
      />
    </div>
  );
}
