import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useLocations } from '../hooks/useLocations';
import type { Mapping } from '../../types';

interface Props {
  jwt: string;
  selectedLocationId: string;
  onLocationChange: (id: string) => void;
}

export default function MappingView({ jwt, selectedLocationId, onLocationChange }: Props) {
  const { locations } = useLocations(jwt);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    sourceField: '', targetAccount: '', targetClass: '', priority: '0',
  });

  const locId = selectedLocationId || locations[0]?.id || '';

  const loadMappings = useCallback(async () => {
    if (!locId) return;
    setLoading(true);
    try {
      const data = await api.getMappings(jwt, locId);
      setMappings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [jwt, locId]);

  useEffect(() => { void loadMappings(); }, [loadMappings]);

  // Auto-select first location
  useEffect(() => {
    if (!selectedLocationId && locations[0]) onLocationChange(locations[0].id);
  }, [locations, selectedLocationId, onLocationChange]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.sourceField || !form.targetAccount) return;
    try {
      await api.createMapping(jwt, locId, {
        sourceField: form.sourceField,
        targetAccount: form.targetAccount,
        targetClass: form.targetClass || undefined,
        priority: parseInt(form.priority, 10) || 0,
      });
      setForm({ sourceField: '', targetAccount: '', targetClass: '', priority: '0' });
      setShowAdd(false);
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this mapping?')) return;
    try {
      await api.deleteMapping(jwt, id);
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div className="p-3">
      {/* Location selector */}
      <div className="flex items-center gap-2 mb-3">
        <select
          value={locId}
          onChange={(e) => onLocationChange(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
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

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-gray-800 border border-gray-600 rounded-lg p-3 mb-3 space-y-2">
          <input
            value={form.sourceField}
            onChange={(e) => setForm({ ...form, sourceField: e.target.value })}
            placeholder="Source field (e.g. Food Sales)"
            className="w-full bg-gray-900 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-cyan-500 focus:outline-none"
            required
          />
          <input
            value={form.targetAccount}
            onChange={(e) => setForm({ ...form, targetAccount: e.target.value })}
            placeholder="QB Account (e.g. 4000-Food Revenue)"
            className="w-full bg-gray-900 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-cyan-500 focus:outline-none"
            required
          />
          <div className="flex gap-2">
            <input
              value={form.targetClass}
              onChange={(e) => setForm({ ...form, targetClass: e.target.value })}
              placeholder="QB Class (optional)"
              className="flex-1 bg-gray-900 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-cyan-500 focus:outline-none"
            />
            <input
              type="number"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              placeholder="Priority"
              className="w-16 bg-gray-900 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAdd(false)} className="text-xs text-gray-500 px-2 py-1">Cancel</button>
            <button type="submit" className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-3 py-1 rounded">Save</button>
          </div>
        </form>
      )}

      {/* Mappings table */}
      {loading ? (
        <div className="text-gray-500 text-xs text-center py-8">Loading…</div>
      ) : mappings.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-2xl mb-2">🗂️</div>
          <p className="text-gray-500 text-xs">No mappings yet. Add your first mapping above.</p>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-500 px-3 py-2">Source</th>
                <th className="text-left text-gray-500 px-3 py-2">QB Account</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="px-3 py-2 text-gray-300">{m.sourceField}</td>
                  <td className="px-3 py-2 text-cyan-300 font-mono">{m.targetAccount}</td>
                  <td className="px-2 py-2">
                    <button
                      onClick={() => void handleDelete(m.id)}
                      className="text-gray-600 hover:text-red-400 text-xs"
                      title="Delete"
                    >✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
