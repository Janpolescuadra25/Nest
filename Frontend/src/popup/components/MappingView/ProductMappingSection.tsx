import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { evaluateProductMatch } from '../../lib/column-extractor';
import { useQBContext } from '../../contexts/QBContext';
import { ConfirmDialog } from '../shared';
import type { Product, ProductMapping, ProductMappingFormData, MatchingRule, MatchingRuleType } from '../../../types';

interface Props {
  jwt: string;
  templateId: string;
}

const POSTING_TYPES = ['Credit', 'Debit'] as const;

export default function ProductMappingSection({ jwt, templateId }: Props) {
  const { accounts, classes } = useQBContext();
  const [products, setProducts] = useState<Product[]>([]);
  const [mappings, setMappings] = useState<ProductMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingMapping, setEditingMapping] = useState<ProductMapping | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState<ProductMappingFormData>({
    templateId,
    productId: '',
    accountId: '',
    postingType: 'Credit',
    classId: undefined,
  });
  const [useRuleEnabled, setUseRuleEnabled] = useState(false);
  const [ruleType, setRuleType] = useState<MatchingRuleType>('EXACT');
  const [ruleThreshold, setRuleThreshold] = useState(0.80);
  const [rulePattern, setRulePattern] = useState('');
  const [ruleDirection, setRuleDirection] = useState<'input_contains_catalog' | 'catalog_contains_input' | 'either'>('either');
  const [testInput, setTestInput] = useState('');
  const [testResults, setTestResults] = useState<{ mappingId: string; productName: string; matched: boolean; confidence: number; matchType: string }[]>([]);
  const [deleteMappingDialog, setDeleteMappingDialog] = useState<{ open: boolean; mapping: ProductMapping | null }>({ open: false, mapping: null });

  const handleTestMatch = () => {
    if (!testInput.trim()) return;
    const results = mappings.map((mapping) => {
      const result = evaluateProductMatch(testInput.trim(), mapping.productName, mapping.matchingRule ?? undefined);
      return {
        mappingId: mapping.id,
        productName: mapping.productName,
        matched: result.matched,
        confidence: result.confidence,
        matchType: result.matchType,
      };
    }).sort((a, b) => b.confidence - a.confidence);
    setTestResults(results);
  };

  useEffect(() => {
    if (!templateId) {
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [productsData, mappingsData] = await Promise.all([
          api.getProducts(jwt),
          api.getProductMappings(jwt, templateId),
        ]);
        setProducts(productsData.sort((a, b) => a.name.localeCompare(b.name)));
        setMappings(mappingsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load product mappings');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [jwt, templateId]);

  useEffect(() => {
    setFormData((prev) => ({ ...prev, templateId }));
    setEditingMapping(null);
    setShowForm(false);
  }, [templateId]);

  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.Active),
    [accounts],
  );

  const accountGroups = useMemo(() => {
    const groups: Record<string, { label: string; options: { value: string; label: string }[] }> = {};
    activeAccounts.forEach((account) => {
      const group = account.Classification || 'Other';
      if (!groups[group]) groups[group] = { label: group, options: [] };
      groups[group].options.push({ value: account.Id, label: account.FullyQualifiedName });
    });
    return Object.values(groups).map((group) => ({ label: group.label, options: group.options }));
  }, [activeAccounts]);

  const activeClasses = useMemo(
    () => classes.filter((klass) => klass.Active),
    [classes],
  );

  const classGroups = useMemo(() => {
    const groups: Record<string, { label: string; options: { value: string; label: string }[] }> = {};
    activeClasses.forEach((klass) => {
      const group = klass.ParentRef?.name || 'Other';
      if (!groups[group]) groups[group] = { label: group, options: [] };
      groups[group].options.push({ value: klass.Id, label: klass.FullyQualifiedName });
    });
    return Object.values(groups).map((group) => ({ label: group.label, options: group.options }));
  }, [activeClasses]);

  const productOptions = useMemo(() => {
    return products.map((product) => ({ value: product.id, label: product.name }));
  }, [products]);

  const accountLabel = (id: string) => {
    const account = accounts.find((item) => item.Id === id);
    return account?.FullyQualifiedName || id;
  };

  const classLabel = (id: string | null) => {
    if (!id) return '—';
    const klass = classes.find((item) => item.Id === id);
    return klass?.FullyQualifiedName || id;
  };

  const resetForm = () => {
    setEditingMapping(null);
    setFormData({
      templateId,
      productId: '',
      accountId: '',
      postingType: 'Credit',
      classId: undefined,
    });
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

  const openEdit = (mapping: ProductMapping) => {
    setEditingMapping(mapping);
    setFormData({
      templateId,
      productId: mapping.productId,
      accountId: mapping.accountId,
      postingType: mapping.postingType,
      classId: mapping.classId ?? undefined,
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
    if (!formData.productId) {
      setError('Product is required');
      return;
    }
    if (!formData.accountId) {
      setError('Account is required');
      return;
    }
    if (!formData.postingType) {
      setError('Posting type is required');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const matchingRule: MatchingRule | null = useRuleEnabled
        ? { type: ruleType, threshold: ruleThreshold, pattern: rulePattern || undefined, direction: ruleDirection, isActive: true }
        : null;

      if (editingMapping) {
        const updated = await api.updateProductMapping(jwt, editingMapping.id, {
          accountId: formData.accountId,
          postingType: formData.postingType,
          classId: formData.classId || undefined,
          matchingRule,
        });
        setMappings((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await api.createProductMapping(jwt, { ...formData, matchingRule });
        setMappings((prev) => [...prev, created].sort((a, b) => a.productName.localeCompare(b.productName)));
      }
      resetForm();
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mapping');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (mapping: ProductMapping) => {
    setDeleteMappingDialog({ open: true, mapping });
  };

  const confirmDeleteMapping = async () => {
    if (!deleteMappingDialog.mapping) return;
    const mapping = deleteMappingDialog.mapping;
    setDeleteMappingDialog({ open: false, mapping: null });

    try {
      await api.deleteProductMapping(jwt, mapping.id);
      setMappings((prev) => prev.filter((item) => item.id !== mapping.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete mapping');
    }
  };

  if (!templateId) {
    return null;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-100 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-600">
          ⚙️ Template Configuration: Product Mappings
        </span>
        <span className="text-gray-600 text-xs">
          {isOpen ? '▲' : '▼'}
        </span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3">
          <p className="text-xs text-gray-600 mb-3">
            Pre-configure product → account bindings for this template. When invoices are scanned, matching products will auto-fill the correct account.
          </p>

          <div className="rounded-xl border border-gray-200 bg-[#F5F5F7] p-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">📦 Product Mappings</h2>
                <p className="text-xs text-gray-600">Bind catalog products to QB accounts for this template.</p>
              </div>
              <button
                type="button"
                onClick={openAdd}
                className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-2"
              >
                + Add Product Mapping
              </button>
            </div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-300 rounded px-3 py-2">
                {error}
              </div>
            )}

            {loading ? (
              <div className="text-xs text-gray-600">Loading product mappings…</div>
            ) : (
              <div className="space-y-4">
                {showForm && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs text-gray-600">Product</label>
                        <select
                          value={formData.productId}
                          onChange={(e) => setFormData((prev) => ({ ...prev, productId: e.target.value }))}
                          disabled={Boolean(editingMapping)}
                          className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                        >
                          <option value="">Select product</option>
                          {productOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Account</label>
                        <select
                          value={formData.accountId}
                          onChange={(e) => setFormData((prev) => ({ ...prev, accountId: e.target.value }))}
                          className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                        >
                          <option value="">Select account</option>
                          {accountGroups.map((group) => (
                            <optgroup key={group.label} label={group.label}>
                              {group.options.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Posting Type</label>
                        <select
                          value={formData.postingType}
                          onChange={(e) => setFormData((prev) => ({ ...prev, postingType: e.target.value as ProductMappingFormData['postingType'] }))}
                          className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                        >
                          {POSTING_TYPES.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Class</label>
                        <select
                          value={formData.classId ?? ''}
                          onChange={(e) => setFormData((prev) => ({ ...prev, classId: e.target.value || undefined }))}
                          className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                        >
                          <option value="">None</option>
                          {classGroups.map((group) => (
                            <optgroup key={group.label} label={group.label}>
                              {group.options.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-200">
                      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={useRuleEnabled} onChange={(e) => setUseRuleEnabled(e.target.checked)} className="rounded" />
                        Custom matching rule
                      </label>
                    </div>

                    {useRuleEnabled && (
                      <div className="grid gap-3 sm:grid-cols-2 mt-3">
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
                            <option value="FUZZY">Fuzzy Match</option>
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

                        {ruleType === 'FUZZY' && (
                          <div>
                            <label className="text-xs text-gray-600">Threshold ({ruleThreshold.toFixed(2)})</label>
                            <input
                              type="range"
                              min="0.50"
                              max="1.00"
                              step="0.05"
                              value={ruleThreshold}
                              onChange={(e) => setRuleThreshold(parseFloat(e.target.value))}
                              className="mt-1 w-full"
                            />
                          </div>
                        )}

                        {ruleType === 'REGEX' && (
                          <div>
                            <label className="text-xs text-gray-600">Pattern</label>
                            <input
                              type="text"
                              value={rulePattern}
                              onChange={(e) => setRulePattern(e.target.value)}
                              placeholder="e.g. ^COCA-\\d+"
                              className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                            />
                          </div>
                        )}
                      </div>
                    )}

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
                    No product mappings yet. Add a mapping to auto-assign accounts when product items are detected in scanned invoices.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-200 bg-[#F5F5F7]">
                    <table className="min-w-full text-left text-xs text-gray-700">
                      <thead>
                        <tr className="border-b border-gray-200 bg-white text-gray-600">
                          <th className="px-3 py-3">Product</th>
                          <th className="px-3 py-3">Account</th>
                          <th className="px-3 py-3">Posting Type</th>
                          <th className="px-3 py-3">Class</th>
                          <th className="px-3 py-3">Match Rule</th>
                          <th className="px-3 py-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mappings.map((mapping) => (
                          <tr key={mapping.id} className="border-b border-gray-200 hover:bg-gray-50">
                            <td className="px-3 py-3 text-gray-700">{mapping.productName}</td>
                            <td className="px-3 py-3 text-gray-600">{accountLabel(mapping.accountId)}</td>
                            <td className={`px-3 py-3 ${mapping.postingType === 'Debit' ? 'text-red-600' : 'text-emerald-600'}`}>
                              {mapping.postingType}
                            </td>
                            <td className="px-3 py-3 text-gray-600">{classLabel(mapping.classId)}</td>
                            <td className="px-3 py-2">
                              {mapping.matchingRule ? (
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                  mapping.matchingRule.type === 'EXACT' ? 'bg-emerald-50 text-emerald-600' :
                                  mapping.matchingRule.type === 'FUZZY' ? 'bg-amber-50 text-amber-600' :
                                  mapping.matchingRule.type === 'REGEX' ? 'bg-gray-50 text-gray-600' :
                                  mapping.matchingRule.type === 'CONTAINS' ? 'bg-emerald-50 text-emerald-600' :
                                  mapping.matchingRule.type === 'STARTS_WITH' ? 'bg-emerald-50 text-emerald-600' :
                                  'bg-gray-200 text-gray-600'
                                }`}>
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
                                className="text-xs text-emerald-400 hover:text-emerald-600"
                              >
                                ✏️
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(mapping)}
                                className="text-xs text-red-600 hover:text-red-600"
                              >
                                🗑️
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
            {mappings.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-[#F5F5F7] p-4 space-y-3">
                <div className="text-sm font-semibold text-gray-900">Test Matcher</div>
                <div className="text-xs text-gray-600">Type a product name to see which mapping it would match.</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={testInput}
                    onChange={(e) => setTestInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleTestMatch(); }}
                    placeholder="e.g. Coca Cola 2L"
                    className="flex-1 rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
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
                      <div key={result.mappingId} className="flex items-center justify-between text-xs rounded px-3 py-2 bg-white">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${result.matched ? 'bg-green-400' : 'bg-gray-600'}`} />
                          <span className="text-gray-700">{result.productName}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-gray-600 font-mono">{result.matchType}</span>
                          <span className={`font-mono ${result.matched ? 'text-emerald-600' : 'text-gray-600'}`}>
                            {(result.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={deleteMappingDialog.open}
        title="Delete Product Mapping"
        message={`Delete product mapping for "${deleteMappingDialog.mapping?.productName}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDeleteMapping}
        onCancel={() => setDeleteMappingDialog({ open: false, mapping: null })}
        variant="danger"
      />
    </div>
  );
}
