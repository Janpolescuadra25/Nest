import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useLocations } from '../hooks/useLocations';
import type { Rule } from '../../types';

interface Props {
  jwt: string;
  selectedLocationId: string;
  onLocationChange: (id: string) => void;
}

const RULE_TYPES = ['COMBINE', 'DEDUCT', 'THRESHOLD', 'FORMULA'] as const;

export default function RulesView({ jwt, selectedLocationId, onLocationChange }: Props) {
  const { locations } = useLocations(jwt);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    ruleType: 'COMBINE' as Rule['ruleType'],
    configJson: '{\n  "sourceFields": ["Field A", "Field B"],\n  "targetField": "Combined Total"\n}',
  });

  const locId = selectedLocationId || locations[0]?.id || '';

  const loadRules = useCallback(async () => {
    if (!locId) return;
    setLoading(true);
    try {
      const data = await api.getRules(jwt, locId);
      setRules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [jwt, locId]);

  useEffect(() => { void loadRules(); }, [loadRules]);

  useEffect(() => {
    if (!selectedLocationId && locations[0]) onLocationChange(locations[0].id);
  }, [locations, selectedLocationId, onLocationChange]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) return;
    try {
      const config = JSON.parse(form.configJson) as Record<string, unknown>;
      await api.createRule(jwt, locId, {
        name: form.name,
        ruleType: form.ruleType,
        config,
        isActive: true,
      });
      setShowAdd(false);
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rule (check JSON)');
    }
  };

  const handleToggle = async (rule: Rule) => {
    try {
      await api.updateRule(jwt, rule.id, { isActive: !rule.isActive });
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this rule?')) return;
    try {
      await api.deleteRule(jwt, id);
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const ruleTypeColor: Record<Rule['ruleType'], string> = {
    COMBINE: 'bg-blue-900 text-blue-300',
    DEDUCT: 'bg-orange-900 text-orange-300',
    THRESHOLD: 'bg-purple-900 text-purple-300',
    FORMULA: 'bg-green-900 text-green-300',
  };

  return (
    <div className="p-3">
      {/* Location selector */}
      <div className="flex items-center gap-2 mb-3">
        <select
          value={locId}
          onChange={(e) => onLocationChange(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-2 py-1.5 rounded-lg"
        >
          + Add
        </button>
      </div>

      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-gray-800 border border-gray-600 rounded-lg p-3 mb-3 space-y-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Rule name"
            className="w-full bg-gray-900 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-cyan-500 focus:outline-none"
            required
          />
          <select
            value={form.ruleType}
            onChange={(e) => setForm({ ...form, ruleType: e.target.value as Rule['ruleType'] })}
            className="w-full bg-gray-900 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:outline-none"
          >
            {RULE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <textarea
            value={form.configJson}
            onChange={(e) => setForm({ ...form, configJson: e.target.value })}
            rows={4}
            className="w-full bg-gray-900 text-green-300 text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-cyan-500 focus:outline-none font-mono resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAdd(false)} className="text-xs text-gray-500 px-2 py-1">Cancel</button>
            <button type="submit" className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-3 py-1 rounded">Save</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-gray-500 text-xs text-center py-8">Loading…</div>
      ) : rules.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-2xl mb-2">⚙️</div>
          <p className="text-gray-500 text-xs">No rules yet. Create your first rule above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${ruleTypeColor[r.ruleType]}`}>
                {r.ruleType}
              </span>
              <span className="flex-1 text-white text-xs truncate">{r.name}</span>
              <button
                onClick={() => void handleToggle(r)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  r.isActive
                    ? 'border-green-600 text-green-400'
                    : 'border-gray-600 text-gray-500'
                }`}
              >
                {r.isActive ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={() => void handleDelete(r.id)}
                className="text-gray-600 hover:text-red-400 text-xs"
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
