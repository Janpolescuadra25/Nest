import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toast';
import type { Location } from '../../types';

interface Props {
  jwt: string;
  onboardingStep?: number;
}

const EMPTY_FORM = { name: '', posUrl: '' };

export default function LocationsTab({ jwt, onboardingStep = 0 }: Props) {
  const { showToast } = useToast();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Add-form state
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addLoading, setAddLoading] = useState(false);

  // Edit state per location
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editForms, setEditForms] = useState<Record<string, Partial<Location>>>({});
  const [editLoading, setEditLoading] = useState<Record<string, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<Record<string, boolean>>({});

  const fetchLocations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getLocations(jwt);
      setLocations(data.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load locations.');
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  useEffect(() => { fetchLocations(); }, [fetchLocations]);

  // ── Create ────────────────────────────────────────────────────────────────
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim() || !addForm.posUrl.trim()) {
      showToast('Name and POS URL are required', 'error');
      return;
    }
    setAddLoading(true);
    try {
      await api.createLocation(jwt, addForm.name.trim(), addForm.posUrl.trim());
      showToast('Location created', 'success');
      setAddForm(EMPTY_FORM);
      setShowAdd(false);
      await fetchLocations();
    } catch (err: any) {
      showToast(err.message || 'Failed to create location', 'error');
    } finally {
      setAddLoading(false);
    }
  };

  // ── Edit ──────────────────────────────────────────────────────────────────
  const openEdit = (loc: Location) => {
    if (expandedId === loc.id) { setExpandedId(null); return; }
    setExpandedId(loc.id);
    setEditForms(p => ({
      ...p,
      [loc.id]: {
        name: loc.name,
        posUrl: loc.posUrl,
        isActive: loc.isActive,
        memoTemplate: loc.memoTemplate ?? '',
        docNumberTemplate: loc.docNumberTemplate ?? '',
      },
    }));
    setConfirmDelete(null);
  };

  const handleEditChange = (id: string, field: keyof Location, value: string | boolean) => {
    setEditForms(p => ({ ...p, [id]: { ...p[id], [field]: value } }));
  };

  const handleSave = async (loc: Location) => {
    const form = editForms[loc.id];
    if (!form) return;
    if (!String(form.name ?? '').trim() || !String(form.posUrl ?? '').trim()) {
      showToast('Name and POS URL are required', 'error');
      return;
    }
    setEditLoading(p => ({ ...p, [loc.id]: true }));
    try {
      await api.updateLocation(jwt, loc.id, {
        name: String(form.name).trim(),
        posUrl: String(form.posUrl).trim(),
        isActive: form.isActive,
        memoTemplate: String(form.memoTemplate ?? '').trim() || undefined,
        docNumberTemplate: String(form.docNumberTemplate ?? '').trim() || undefined,
      });
      showToast('Location updated', 'success');
      setExpandedId(null);
      await fetchLocations();
    } catch (err: any) {
      showToast(err.message || 'Failed to update location', 'error');
    } finally {
      setEditLoading(p => ({ ...p, [loc.id]: false }));
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    setDeleteLoading(p => ({ ...p, [id]: true }));
    try {
      await api.deleteLocation(jwt, id);
      showToast('Location deleted', 'success');
      setExpandedId(null);
      setConfirmDelete(null);
      await fetchLocations();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete location', 'error');
    } finally {
      setDeleteLoading(p => ({ ...p, [id]: false }));
    }
  };

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-white">Locations</h2>
        <div className="flex items-center gap-2">
          <button onClick={fetchLocations} className="text-xs text-gray-500 hover:text-gray-300">↻</button>
          <button
            onClick={() => { setShowAdd(p => !p); setAddForm(EMPTY_FORM); }}
            className="text-xs px-2 py-1 bg-emerald-700 text-emerald-200 rounded hover:bg-emerald-600"
          >
            {showAdd ? 'Cancel' : '+ Add'}
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-slate-800 rounded-lg p-3 space-y-2">
          <p className="text-xs text-gray-400 font-medium">New Location</p>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Name</label>
            <input
              type="text"
              value={addForm.name}
              onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Main Store"
              className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">POS URL</label>
            <input
              type="url"
              value={addForm.posUrl}
              onChange={e => setAddForm(p => ({ ...p, posUrl: e.target.value }))}
              placeholder="https://pos.example.com"
              className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={addLoading}
            className="w-full py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-500 disabled:opacity-50"
          >
            {addLoading ? 'Creating…' : 'Create Location'}
          </button>
        </form>
      )}

      {/* States */}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : locations.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-3xl mb-2">📍</div>
          <p className="text-gray-400 text-sm mb-1">
            {onboardingStep === 2 ? 'Add your first location to start syncing' : 'No locations yet'}
          </p>
          <p className="text-gray-600 text-xs">
            {onboardingStep === 2 ? 'Locations connect your POS data to QuickBooks' : 'Add one above'}
          </p>
        </div>
      ) : (
        locations.map(loc => {
          const form = editForms[loc.id] ?? {};
          const isExpanded = expandedId === loc.id;
          return (
            <div key={loc.id} className="bg-slate-800 rounded-lg p-3 space-y-2">
              {/* Row header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">{loc.name}</div>
                  <div className="text-xs text-gray-400 truncate">{loc.posUrl}</div>
                  <div className="mt-1">
                    {loc.isActive
                      ? <span className="text-xs px-1 py-0.5 rounded bg-green-900 text-green-400">Active</span>
                      : <span className="text-xs px-1 py-0.5 rounded bg-red-900 text-red-400">Inactive</span>
                    }
                  </div>
                </div>
                <button onClick={() => openEdit(loc)} className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0">
                  {isExpanded ? '▲' : '▼'}
                </button>
              </div>

              {/* Edit form */}
              {isExpanded && (
                <div className="pt-2 border-t border-slate-700 space-y-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Name</label>
                    <input
                      type="text"
                      aria-label="Location name"
                      value={String(form.name ?? '')}
                      onChange={e => handleEditChange(loc.id, 'name', e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">POS URL</label>
                    <input
                      type="url"
                      aria-label="POS URL"
                      value={String(form.posUrl ?? '')}
                      onChange={e => handleEditChange(loc.id, 'posUrl', e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Memo template</label>
                    <input
                      type="text"
                      value={String(form.memoTemplate ?? '')}
                      onChange={e => handleEditChange(loc.id, 'memoTemplate', e.target.value)}
                      placeholder="e.g. {date} {location}"
                      className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Doc number template</label>
                    <input
                      type="text"
                      value={String(form.docNumberTemplate ?? '')}
                      onChange={e => handleEditChange(loc.id, 'docNumberTemplate', e.target.value)}
                      placeholder="e.g. JE-{date}"
                      className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">Active</p>
                    <button
                      type="button"
                      onClick={() => handleEditChange(loc.id, 'isActive', !form.isActive)}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${form.isActive ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-gray-500'}`}
                    >
                      {form.isActive ? 'Yes' : 'No'}
                    </button>
                  </div>
                  <button
                    onClick={() => handleSave(loc)}
                    disabled={editLoading[loc.id]}
                    className="w-full py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {editLoading[loc.id] ? 'Saving…' : 'Save Changes'}
                  </button>

                  {/* Delete */}
                  <div className="pt-1 border-t border-slate-700">
                    {confirmDelete === loc.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDelete(loc.id)}
                          disabled={deleteLoading[loc.id]}
                          className="flex-1 py-1.5 bg-red-800 text-red-200 rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                        >
                          {deleteLoading[loc.id] ? 'Deleting…' : 'Confirm Delete'}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="px-3 py-1.5 bg-slate-700 text-gray-400 rounded text-xs hover:bg-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(loc.id)}
                        className="w-full py-1.5 bg-red-900 text-red-300 rounded text-xs font-medium hover:bg-red-800"
                      >
                        Delete Location
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
