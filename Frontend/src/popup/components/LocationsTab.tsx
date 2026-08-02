import React, { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../lib/api';
import { useToast } from './Toast';
import UpgradePrompt from './UpgradePrompt';
import type { Location, LocationAttachment } from '../../types';

interface Props {
  jwt: string;
  onboardingStep?: number;
  onUpgrade?: () => void;
}

const EMPTY_FORM = { name: '' };

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function LocationsTab({ jwt, onboardingStep = 0, onUpgrade }: Props) {
  const { showToast } = useToast();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState('');

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
  const [attachments, setAttachments] = useState<LocationAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);

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

  useEffect(() => {
    if (expandedId && jwt) {
      api.getLocationAttachments(jwt, expandedId).then(setAttachments).catch(() => setAttachments([]));
    } else {
      setAttachments([]);
    }
  }, [expandedId, jwt]);

  // ── Create ────────────────────────────────────────────────────────────────
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim()) {
      showToast('Location name is required', 'error');
      return;
    }
    setAddLoading(true);
    try {
      await api.createLocation(jwt, addForm.name.trim());
      showToast('Location created', 'success');
      setShowUpgrade(false);
      setUpgradeMessage('');
      setAddForm(EMPTY_FORM);
      setShowAdd(false);
      await fetchLocations();
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 403 && err.payload?.error === 'LOCATION_LIMIT_REACHED') {
          setUpgradeMessage('Location limit reached. Upgrade your plan to add more locations.');
          setShowUpgrade(true);
          return;
        }
      }
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
        description: loc.description || '',
        isActive: loc.isActive,
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
    if (!String(form.name ?? '').trim()) {
      showToast('Location name is required', 'error');
      return;
    }
    setEditLoading(p => ({ ...p, [loc.id]: true }));
    try {
      await api.updateLocation(jwt, loc.id, {
        name: String(form.name).trim(),
        description: String(form.description ?? '').trim() || undefined,
        isActive: form.isActive,
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

  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !expandedId || !jwt) return;
    setUploadingAttachment(true);
    try {
      await api.uploadLocationAttachment(jwt, expandedId, file);
      const updated = await api.getLocationAttachments(jwt, expandedId);
      setAttachments(updated);
      showToast('Attachment uploaded', 'success');
    } catch {
      showToast('Failed to upload attachment', 'error');
    } finally {
      setUploadingAttachment(false);
      if (e.target) (e.target as HTMLInputElement).value = '';
    }
  };

  const handleAttachmentDelete = async (attachmentId: string) => {
    if (!expandedId || !jwt) return;
    setDeletingAttachmentId(attachmentId);
    try {
      await api.deleteLocationAttachment(jwt, expandedId, attachmentId);
      setAttachments(prev => prev.filter(a => a.id !== attachmentId));
      showToast('Attachment deleted', 'success');
    } catch {
      showToast('Failed to delete attachment', 'error');
    } finally {
      setDeletingAttachmentId(null);
    }
  };

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-gray-900">Locations</h2>
        <div className="flex items-center gap-2">
          <button onClick={fetchLocations} className="text-xs text-gray-600 hover:text-gray-600">↻</button>
          <button
            onClick={() => { setShowAdd(p => !p); setAddForm(EMPTY_FORM); }}
            className="text-xs px-2 py-1 bg-emerald-700 text-emerald-200 rounded hover:bg-emerald-600"
          >
            {showAdd ? 'Cancel' : '+ Add'}
          </button>
        </div>
      </div>

      {showUpgrade && (
        <UpgradePrompt
          message={upgradeMessage}
          onUpgrade={() => { onUpgrade?.(); setShowUpgrade(false); }}
        />
      )}

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
          <p className="text-xs text-gray-600 font-medium">New Location</p>
          <div>
            <label className="block text-xs text-gray-600 mb-0.5">Name</label>
            <input
              type="text"
              value={addForm.name}
              onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Main Store"
              className="w-full px-2 py-1.5 bg-gray-200 border border-gray-300 rounded text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500"
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
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {loading ? (
        <p className="text-gray-600 text-sm">Loading…</p>
      ) : locations.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-3xl mb-2">📍</div>
          <p className="text-gray-600 text-sm mb-1">
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
            <div key={loc.id} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
              {/* Row header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{loc.name}</div>
                  {loc.description && (
                    <div className="text-xs text-gray-500 truncate">{loc.description}</div>
                  )}
                  <div className="mt-1">
                    {loc.isActive
                      ? <span className="text-xs px-1 py-0.5 rounded bg-emerald-50 text-emerald-600">Active</span>
                      : <span className="text-xs px-1 py-0.5 rounded bg-red-50 text-red-600">Inactive</span>
                    }
                  </div>
                </div>
                <button onClick={() => openEdit(loc)} className="text-gray-600 hover:text-gray-600 text-xs flex-shrink-0">
                  {isExpanded ? '▲' : '▼'}
                </button>
              </div>

              {/* Edit form */}
              {isExpanded && (
                <div className="pt-2 border-t border-gray-200 space-y-2">
                  <div>
                    <label className="block text-xs text-gray-600 mb-0.5">Name</label>
                    <input
                      type="text"
                      aria-label="Location name"
                      value={String(form.name ?? '')}
                      onChange={e => handleEditChange(loc.id, 'name', e.target.value)}
                      className="w-full px-2 py-1.5 bg-gray-200 border border-gray-300 rounded text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-0.5">Description</label>
                    <textarea
                      value={String(form.description ?? '')}
                      onChange={e => handleEditChange(loc.id, 'description', e.target.value)}
                      placeholder="Optional description for this location"
                      rows={3}
                      className="w-full px-2 py-1.5 bg-gray-200 border border-gray-300 rounded text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500 resize-y"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-600">Active</p>
                    <button
                      type="button"
                      onClick={() => handleEditChange(loc.id, 'isActive', !form.isActive)}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${form.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-200 text-gray-600'}`}
                    >
                      {form.isActive ? 'Yes' : 'No'}
                    </button>
                  </div>
                  {/* Attachments */}
                  <div>
                    <label className="block text-xs text-gray-600 mb-0.5">Attachments</label>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.txt"
                      onChange={handleAttachmentUpload}
                      disabled={uploadingAttachment}
                      className="block w-full text-xs text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-medium file:bg-emerald-600 file:text-white hover:file:bg-emerald-700 disabled:opacity-50"
                    />
                    {uploadingAttachment && <p className="text-xs text-gray-400 mt-1">Uploading...</p>}
                    {attachments.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {attachments.map((att) => (
                          <div key={att.id} className="flex items-center justify-between text-xs bg-gray-100 rounded px-2 py-1.5">
                            <div className="flex-1 min-w-0">
                              <a
                                href={att.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline truncate block"
                                title={att.fileName}
                              >
                                {att.fileName}
                              </a>
                              <span className="text-gray-400">{formatFileSize(att.fileSize)}</span>
                            </div>
                            <button
                              onClick={() => handleAttachmentDelete(att.id)}
                              disabled={deletingAttachmentId === att.id}
                              className="text-red-500 hover:text-red-700 ml-2 shrink-0 disabled:opacity-50"
                            >
                              {deletingAttachmentId === att.id ? '...' : '✕'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleSave(loc)}
                    disabled={editLoading[loc.id]}
                    className="w-full py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {editLoading[loc.id] ? 'Saving…' : 'Save Changes'}
                  </button>

                  {/* Delete */}
                  <div className="pt-1 border-t border-gray-200">
                    {confirmDelete === loc.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDelete(loc.id)}
                          disabled={deleteLoading[loc.id]}
                          className="flex-1 py-1.5 bg-red-800 text-red-700 rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                        >
                          {deleteLoading[loc.id] ? 'Deleting…' : 'Confirm Delete'}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(loc.id)}
                        className="w-full py-1.5 bg-red-50 text-red-600 rounded text-xs font-medium hover:bg-red-700"
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
