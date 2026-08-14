import React, { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../lib/api';
import { hasPerm } from '../lib/permissions';
import { useToast } from './Toast';
import { ErrorCard, StatusBadge, PermissionToggle, DashboardSkeleton, EmptyState } from './shared';
import { trialCountdown } from '../lib/utils';
import { BACKEND_URL } from '../../lib/config';
import UpgradePrompt from './UpgradePrompt';
import type { TeamMember, InviteLink } from '../../types';

interface InviteResult {
  user: { id: string; email: string; name: string | null; role: string };
  tempPassword: string;
}

interface Props {
  jwt: string;
  subscriptionSource?: string | null;
  onUpgrade?: () => void;
  userRole?: string;
}

const ROLE_OPTIONS = ['VIEWER', 'STAFF', 'ACCOUNTANT', 'MANAGER'];

export default function MyTeamTab({ jwt, subscriptionSource, onUpgrade, userRole }: Props) {
  const { showToast } = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [inviteMode, setInviteMode] = useState<'email' | 'link'>('email');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('STAFF');
  const [inviteName, setInviteName] = useState('');
  const [inviteTrialDays, setInviteTrialDays] = useState('');
  const [inviteExpiryMsg, setInviteExpiryMsg] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // trial editing: keyed by member id
  const [trialEnabled, setTrialEnabled] = useState<Record<string, boolean>>({});
  const [trialDate, setTrialDate] = useState<Record<string, string>>({});
  const [trialMsg, setTrialMsg] = useState<Record<string, string>>({});
  const [trialLoading, setTrialLoading] = useState<Record<string, boolean>>({});

  // Time bomb state: keyed by member id
  const [bombDate, setBombDate] = useState<Record<string, string>>({});
  const [bombGrace, setBombGrace] = useState<Record<string, string>>({});
  const [showBombForm, setShowBombForm] = useState<Record<string, boolean>>({});

  // Invite links state
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);
  const [linkRoleHint, setLinkRoleHint] = useState('VIEWER');
  const [linkExpiry, setLinkExpiry] = useState('72');
  const [linkMaxUses, setLinkMaxUses] = useState('1');
  const [linkScans, setLinkScans] = useState('0');
  const [linkLocations, setLinkLocations] = useState('0');
  const [linkStorageUnlimited, setLinkStorageUnlimited] = useState(true);
  const [linkStorageValue, setLinkStorageValue] = useState('1024');
  const [linkStorageUnit, setLinkStorageUnit] = useState<'MB' | 'GB'>('GB');
  const [createdLink, setCreatedLink] = useState<InviteLink | null>(null);
  const [allocationDraft, setAllocationDraft] = useState<Record<string, { scans: string; locations: string; templates: string }>>({});
  const [allocationSaving, setAllocationSaving] = useState<Record<string, boolean>>({});

  const fetchTeam = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getAdminTeam(jwt);
      setMembers(data.users);
    } catch (err: any) {
      setError(err.message || 'Failed to load team.');
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  const fetchInviteLinks = useCallback(async () => {
    try {
      const data = await api.listInviteLinks(jwt);
      setInviteLinks(data.invites);
    } catch {
      // silent — non-critical
    }
  }, [jwt]);

  useEffect(() => { fetchTeam(); fetchInviteLinks(); }, [fetchTeam, fetchInviteLinks]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(p => ({ ...p, invite: true }));
    setError('');
    try {
      const trialDaysNum = inviteTrialDays ? parseInt(inviteTrialDays, 10) : undefined;
      const result = await api.inviteTeamMember(jwt, inviteEmail, inviteRole, inviteName || undefined, trialDaysNum, inviteExpiryMsg.trim() || undefined);
      setInviteResult(result);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('STAFF');
      setInviteTrialDays('');
      setInviteExpiryMsg('');
      setShowInvitePanel(false);
      await fetchTeam();
      showToast('Invitation sent!', 'success');
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 403 && err.payload?.error === 'USER_LIMIT_REACHED') {
        setError('Team member limit reached. Upgrade your plan to add more members.');
        return;
      }
      setError(err.message || 'Failed to invite member.');
      showToast('Failed to send invitation', 'error');
    } finally {
      setActionLoading(p => ({ ...p, invite: false }));
    }
  };

  const handleDisable = async (id: string) => {
    setActionLoading(p => ({ ...p, [id]: true }));
    try {
      await api.disableTeamMember(jwt, id);
      await fetchTeam();
      showToast('Member disabled', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to disable member.');
      showToast('Failed to disable member', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [id]: false }));
    }
  };

  const handlePatchPerm = async (id: string, permissionKey: string, value: boolean) => {
    setActionLoading(p => ({ ...p, [`p_${id}_${permissionKey}`]: true }));
    try {
      await api.patchTeamMember(jwt, id, { permissions: { [permissionKey]: value } });
      await fetchTeam();
      showToast('Member updated', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to update permission.');
      showToast('Update failed', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`p_${id}_${permissionKey}`]: false }));
    }
  };

  const handleRoleChange = async (id: string, role: string) => {
    setActionLoading(p => ({ ...p, [`role_${id}`]: true }));
    try {
      await api.changeUserRole(jwt, id, role);
      await fetchTeam();
      showToast('Role updated', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to update role.');
      showToast('Update failed', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`role_${id}`]: false }));
    }
  };

  const handleSaveAllocation = async (memberId: string) => {
    const draft = allocationDraft[memberId];
    if (!draft) return;
    setAllocationSaving(prev => ({ ...prev, [memberId]: true }));
    try {
      const body: Record<string, number | null> = {};
      if (draft.scans !== '') body.allocatedScans = draft.scans === '0' ? 0 : Number(draft.scans);
      if (draft.locations !== '') body.allocatedLocations = draft.locations === '0' ? 0 : Number(draft.locations);
      if (draft.templates !== '') body.allocatedTemplates = draft.templates === '0' ? 0 : Number(draft.templates);
      if (Object.keys(body).length === 0) return;
      await api.patchTeamMemberAllocation(jwt, memberId, body);
      await fetchTeam();
      setAllocationDraft(prev => {
        const next = { ...prev };
        delete next[memberId];
        return next;
      });
      showToast('Allocation updated', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update allocation', 'error');
    } finally {
      setAllocationSaving(prev => ({ ...prev, [memberId]: false }));
    }
  };

  const handleExpandMember = (member: TeamMember) => {
    const isOpening = expandedId !== member.id;
    setExpandedId(isOpening ? member.id : null);
    if (isOpening) {
      const hasTrial = !!member.trialExpiresAt;
      setTrialEnabled(p => ({ ...p, [member.id]: hasTrial }));
      setTrialDate(p => ({
        ...p,
        [member.id]: member.trialExpiresAt ? member.trialExpiresAt.slice(0, 10) : '',
      }));
      setTrialMsg(p => ({ ...p, [member.id]: member.customExpiryMessage ?? '' }));
      // Init bomb state
      setBombDate(p => ({ ...p, [member.id]: '' }));
      setBombGrace(p => ({ ...p, [member.id]: '24' }));
      setShowBombForm(p => ({ ...p, [member.id]: false }));
    }
  };

  const handleTrialSave = async (id: string) => {
    setTrialLoading(p => ({ ...p, [id]: true }));
    try {
      const enabled = trialEnabled[id];
      const hasDate = enabled && !!trialDate[id];
      const data: Record<string, unknown> = {
        trialExpiresAt: hasDate ? new Date(trialDate[id]).toISOString() : null,
        customExpiryMessage: enabled && trialMsg[id] ? trialMsg[id] : null,
      };
      await api.patchTeamMember(jwt, id, data);
      await fetchTeam();
      showToast(hasDate ? 'Trial period renewed' : 'Trial settings saved', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to save trial settings.');
      showToast('Failed to save trial settings', 'error');
    } finally {
      setTrialLoading(p => ({ ...p, [id]: false }));
    }
  };

  const handleSetTimeBomb = async (id: string) => {
    const dateVal = bombDate[id];
    if (!dateVal) { showToast('Select a date', 'error'); return; }
    const grace = bombGrace[id] ? Number(bombGrace[id]) : undefined;
    setActionLoading(p => ({ ...p, [`bomb_${id}`]: true }));
    try {
      await api.setTimeBomb(jwt, id, new Date(dateVal).toISOString(), grace);
      await fetchTeam();
      setShowBombForm(p => ({ ...p, [id]: false }));
      showToast('Time bomb set', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to set time bomb.');
      showToast('Failed to set time bomb', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`bomb_${id}`]: false }));
    }
  };

  const handleClearTimeBomb = async (id: string) => {
    setActionLoading(p => ({ ...p, [`bomb_${id}`]: true }));
    try {
      await api.clearTimeBomb(jwt, id);
      await fetchTeam();
      showToast('Time bomb cleared', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to clear time bomb.');
      showToast('Failed to clear time bomb', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`bomb_${id}`]: false }));
    }
  };

  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(p => ({ ...p, linkCreate: true }));
    try {
      const result = await api.createInviteLink(jwt, {
        roleHint: linkRoleHint,
        expiresInHours: Number(linkExpiry) || 72,
        maxUses: Number(linkMaxUses) || 1,
        maxScans: linkScans === '' ? null : Number(linkScans),
        maxLocations: linkLocations === '' ? null : Number(linkLocations),
        maxStorageBytes: linkStorageUnlimited ? null : Math.max(0, Number(linkStorageValue) || 0) * (linkStorageUnit === 'GB' ? 1073741824 : 1048576),
      });
      setCreatedLink(result.invite);
      setLinkRoleHint('VIEWER');
      setLinkExpiry('72');
      setLinkMaxUses('1');
      setLinkScans('0');
      setLinkLocations('0');
      setLinkStorageUnlimited(true);
      setLinkStorageValue('1024');
      setLinkStorageUnit('GB');
      setShowInvitePanel(false);
      await fetchInviteLinks();
      showToast('Invite link created!', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to create link.');
      showToast('Failed to create link', 'error');
    } finally {
      setActionLoading(p => ({ ...p, linkCreate: false }));
    }
  };

  const handleRevokeLink = async (id: string) => {
    setActionLoading(p => ({ ...p, [`revoke_${id}`]: true }));
    try {
      await api.revokeInviteLink(jwt, id);
      await fetchInviteLinks();
      showToast('Link revoked', 'success');
    } catch (err: any) {
      showToast('Failed to revoke link', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`revoke_${id}`]: false }));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => showToast('Link copied!', 'success'),
      () => showToast('Failed to copy', 'error')
    );
  };

  const effectiveBadge = (member: TeamMember) => {
    const st = member.status;
    if (st === 'GRACE_PERIOD') return <StatusBadge status="GRACE_PERIOD" />;
    if (st === 'TIME_BOMBED') return <StatusBadge status="TIME_BOMBED" />;
    if (st === 'PENDING_APPROVAL') return <StatusBadge status="PENDING_APPROVAL" />;
    return null;
  };

  const isFreeUser = !subscriptionSource;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-gray-900">My Team</h2>
        <button
          onClick={() => {
            if (showInvitePanel) {
              setShowInvitePanel(false);
            } else {
              setInviteMode('email');
              setShowInvitePanel(true);
            }
          }}
          disabled={isFreeUser}
          className={`text-xs px-2 py-1 rounded ${isFreeUser ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-emerald-700 text-emerald-200 hover:bg-emerald-600'}`}
        >
          + Invite
        </button>
      </div>

      {isFreeUser && (
        <UpgradePrompt
          message="Team access requires a paid plan. Upgrade to invite team members and manage permissions."
          onUpgrade={() => onUpgrade?.()}
        />
      )}

      {showInvitePanel && (
        <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded mb-3">
          <button
            onClick={() => setInviteMode('email')}
            className={`text-xs px-3 py-1 rounded transition-colors ${
              inviteMode === 'email'
                ? 'bg-white text-gray-900 shadow-sm font-medium'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Email
          </button>
          <button
            onClick={() => setInviteMode('link')}
            className={`text-xs px-3 py-1 rounded transition-colors ${
              inviteMode === 'link'
                ? 'bg-white text-gray-900 shadow-sm font-medium'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Link
          </button>
        </div>
      )}

      {inviteResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
          <p className="text-emerald-600 font-medium">Member invited!</p>
          <p className="text-gray-600 text-xs mt-1">Email: <span className="font-mono">{inviteResult.user.email}</span></p>
          <p className="text-gray-600 text-xs">Temp password: <span className="font-mono text-amber-600">{inviteResult.tempPassword}</span></p>
          <p className="text-gray-600 text-xs mt-1">Share this password securely — they'll be prompted to change it on first login.</p>
          <button onClick={() => setInviteResult(null)} className="mt-2 text-xs text-gray-600 hover:text-gray-600">Dismiss</button>
        </div>
      )}

      {createdLink && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
          <p className="text-emerald-600 font-medium">Invite link created!</p>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 text-xs text-gray-600 bg-white px-2 py-1 rounded break-all">{BACKEND_URL}/api/invite/{createdLink.token}</code>
            <button
              onClick={() => copyToClipboard(`${BACKEND_URL}/api/invite/${createdLink.token}`)}
              className="text-xs px-2 py-1 bg-emerald-700 text-emerald-200 rounded hover:bg-emerald-600 flex-shrink-0"
            >
              Copy
            </button>
          </div>
          <p className="text-gray-600 text-xs mt-1">Share this link — it expires {new Date(createdLink.expiresAt).toLocaleString()}</p>
          <button onClick={() => setCreatedLink(null)} className="mt-2 text-xs text-gray-600 hover:text-gray-600">Dismiss</button>
        </div>
      )}

      {showInvitePanel && inviteMode === 'email' && (
        <form onSubmit={handleInvite} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
          <input
            type="email"
            placeholder="Email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            required
            className="w-full px-2 py-1.5 bg-gray-200 border border-gray-300 rounded text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500"
          />
          <input
            type="text"
            placeholder="Name (optional)"
            value={inviteName}
            onChange={e => setInviteName(e.target.value)}
            className="w-full px-2 py-1.5 bg-gray-200 border border-gray-300 rounded text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500"
          />
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
            className="w-full px-2 py-1.5 bg-gray-200 border border-gray-300 rounded text-sm text-gray-600 focus:outline-none"
          >
            {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {subscriptionSource !== 'stripe' ? (
            <>
              <div>
                <label className="block text-xs text-gray-600 mb-0.5">Trial period (days)</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  placeholder="e.g. 30"
                  value={inviteTrialDays}
                  onChange={e => setInviteTrialDays(e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-200 border border-gray-300 rounded text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-0.5">Expiry message (shown to user when trial ends)</label>
                <textarea
                  placeholder="e.g. Contact me to renew your access"
                  value={inviteExpiryMsg}
                  onChange={e => setInviteExpiryMsg(e.target.value)}
                  maxLength={200}
                  rows={2}
                  className="w-full px-2 py-1.5 bg-gray-200 border border-gray-300 rounded text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>
            </>
          ) : (
            <div className="text-xs text-gray-600">Team access is managed through your Stripe subscription.</div>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={actionLoading['invite']} className="flex-1 py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-500 disabled:opacity-50">
              {actionLoading['invite'] ? 'Inviting...' : 'Send Invite'}
            </button>
            <button type="button" onClick={() => setShowInvitePanel(false)} className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300">
              Cancel
            </button>
          </div>
        </form>
      )}

      {showInvitePanel && inviteMode === 'link' && (
        <form onSubmit={handleCreateLink} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
          <p className="text-xs text-gray-600 font-medium">Create Invite Link</p>
          <select
            value={linkRoleHint}
            onChange={e => setLinkRoleHint(e.target.value)}
            className="w-full px-2 py-1.5 bg-gray-200 border border-gray-300 rounded text-sm text-gray-600 focus:outline-none"
          >
            {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label className="block text-xs text-gray-600 mb-0.5">Scans allocation</label>
              <input
                type="number"
                min={0}
                value={linkScans}
                onChange={e => setLinkScans(e.target.value)}
                className="w-full px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-0.5">Locations allocation</label>
              <input
                type="number"
                min={0}
                value={linkLocations}
                onChange={e => setLinkLocations(e.target.value)}
                className="w-full px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs text-gray-600">Storage allocation</label>
                <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={linkStorageUnlimited}
                    onChange={e => setLinkStorageUnlimited(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Unlimited
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_100px]">
                <input
                  type="number"
                  min={0}
                  value={linkStorageValue}
                  onChange={e => setLinkStorageValue(e.target.value)}
                  disabled={linkStorageUnlimited}
                  placeholder="Amount"
                  className="w-full px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                />
                <select
                  value={linkStorageUnit}
                  onChange={e => setLinkStorageUnit(e.target.value as 'MB' | 'GB')}
                  disabled={linkStorageUnlimited}
                  className="w-full px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                >
                  <option value="MB">MB</option>
                  <option value="GB">GB</option>
                </select>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-600 mb-0.5">Expires (hours)</label>
              <input
                type="number"
                min={1}
                max={720}
                value={linkExpiry}
                onChange={e => setLinkExpiry(e.target.value)}
                className="w-full px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-600 mb-0.5">Max uses</label>
              <input
                type="number"
                min={1}
                max={100}
                value={linkMaxUses}
                onChange={e => setLinkMaxUses(e.target.value)}
                className="w-full px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={actionLoading['linkCreate']} className="flex-1 py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-500 disabled:opacity-50">
              {actionLoading['linkCreate'] ? 'Creating...' : 'Create Link'}
            </button>
            <button type="button" onClick={() => setShowInvitePanel(false)} className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Invite Links List */}
      {inviteLinks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-600 font-medium">Invite Links</p>
          {inviteLinks.map(link => (
            <div key={link.id} className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-600">{link.roleHint}</span>
                  <span className={`text-xs px-1 py-0.5 rounded ${link.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-200 text-gray-600'}`}>
                    {link.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="text-xs text-gray-600">
                  Uses: {link.useCount}/{link.maxUses} · Expires: {new Date(link.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => handleRevokeLink(link.id)}
                disabled={actionLoading[`revoke_${link.id}`]}
                className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-700 disabled:opacity-50 flex-shrink-0"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <ErrorCard message={error} onRetry={fetchTeam} onDismiss={() => setError('')} />
      )}
      {loading ? (
        <DashboardSkeleton type="list" rows={3} />
      ) : members.length === 0 ? (
        <EmptyState
          icon="👥"
          title="No team members yet"
          description="Invite someone to get your team started."
          action={{ label: 'Invite member', onClick: () => { setInviteMode('email'); setShowInvitePanel(true); } }}
        />
      ) : (
        members.map(member => (
          <div key={member.id} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{member.name ?? member.email}</div>
                {member.name && <div className="text-xs text-gray-600 truncate">{member.email}</div>}
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-xs text-gray-600">{member.role}</span>
                  <StatusBadge status={member.blocked ? 'BLOCKED' : member.status} />
                  {effectiveBadge(member)}
                  {member.mustChangePassword && <span className="text-xs text-amber-600">⚠ needs pw change</span>}
                  {trialCountdown(member.trialExpiresAt)}
                </div>
              </div>
              <button onClick={() => handleExpandMember(member)} className="text-gray-600 hover:text-gray-600 text-xs flex-shrink-0">
                {expandedId === member.id ? '▲' : '▼'}
              </button>
            </div>
            {expandedId === member.id && (
              <div className="pt-2 border-t border-gray-200 space-y-3">
                <div>
                  <p className="text-xs text-gray-600 mb-1">Role</p>
                  <div className="flex gap-1 flex-wrap">
                    {ROLE_OPTIONS.map(r => (
                      <button
                        key={r}
                        onClick={() => handleRoleChange(member.id, r)}
                        disabled={actionLoading[`role_${member.id}`] || member.role === r}
                        className={`px-2 py-0.5 rounded text-xs disabled:opacity-50 ${member.role === r ? 'bg-emerald-700 text-emerald-200' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Permissions</p>
                  <div className="flex gap-1 flex-wrap">
                    <PermissionToggle
                      feature="scan"
                      action="write"
                      enabled={hasPerm(member, 'scan', 'write')}
                      disabled={actionLoading[`p_${member.id}_scan:write`]}
                      onChange={(feature, action, enabled) => handlePatchPerm(member.id, `${feature}:${action}`, enabled)}
                    />
                    <PermissionToggle
                      feature="map"
                      action="write"
                      enabled={hasPerm(member, 'map', 'write')}
                      disabled={actionLoading[`p_${member.id}_map:write`]}
                      onChange={(feature, action, enabled) => handlePatchPerm(member.id, `${feature}:${action}`, enabled)}
                    />
                    <PermissionToggle
                      feature="sync"
                      action="execute"
                      enabled={hasPerm(member, 'sync', 'execute')}
                      disabled={actionLoading[`p_${member.id}_sync:execute`]}
                      onChange={(feature, action, enabled) => handlePatchPerm(member.id, `${feature}:${action}`, enabled)}
                    />
                    <PermissionToggle
                      feature="locations"
                      action="write"
                      enabled={hasPerm(member, 'locations', 'write')}
                      disabled={actionLoading[`p_${member.id}_locations:write`]}
                      onChange={(feature, action, enabled) => handlePatchPerm(member.id, `${feature}:${action}`, enabled)}
                    />
                  </div>
                </div>
                {userRole === 'ADMIN' && (
                  <div className="pt-2 border-t border-gray-200 space-y-2">
                    <p className="text-xs text-gray-600 font-medium">Resource Allocation</p>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-gray-500">Scans/wk</label>
                        <input
                          type="number"
                          min="0"
                          placeholder={member.allocatedScans != null ? String(member.allocatedScans) : 'No limit'}
                          value={allocationDraft[member.id]?.scans ?? ''}
                          onChange={e => setAllocationDraft(prev => ({
                            ...prev,
                            [member.id]: { ...prev[member.id], scans: e.target.value, locations: prev[member.id]?.locations ?? '', templates: prev[member.id]?.templates ?? '' }
                          }))}
                          className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Locations</label>
                        <input
                          type="number"
                          min="0"
                          placeholder={member.allocatedLocations != null ? String(member.allocatedLocations) : 'No limit'}
                          value={allocationDraft[member.id]?.locations ?? ''}
                          onChange={e => setAllocationDraft(prev => ({
                            ...prev,
                            [member.id]: { ...prev[member.id], locations: e.target.value, scans: prev[member.id]?.scans ?? '', templates: prev[member.id]?.templates ?? '' }
                          }))}
                          className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Templates</label>
                        <input
                          type="number"
                          min="0"
                          placeholder={member.allocatedTemplates != null ? String(member.allocatedTemplates) : 'No limit'}
                          value={allocationDraft[member.id]?.templates ?? ''}
                          onChange={e => setAllocationDraft(prev => ({
                            ...prev,
                            [member.id]: { ...prev[member.id], templates: e.target.value, scans: prev[member.id]?.scans ?? '', locations: prev[member.id]?.locations ?? '' }
                          }))}
                          className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                        />
                      </div>
                    </div>
                    {allocationDraft[member.id] && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSaveAllocation(member.id)}
                          disabled={allocationSaving[member.id]}
                          className="text-xs px-3 py-1 bg-emerald-700 text-white rounded hover:bg-emerald-800 disabled:opacity-50"
                        >
                          {allocationSaving[member.id] ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setAllocationDraft(prev => {
                            const next = { ...prev };
                            delete next[member.id];
                            return next;
                          })}
                          className="text-xs px-3 py-1 bg-gray-200 text-gray-600 rounded hover:bg-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    <p className="text-xs text-gray-400">
                      Leave empty to keep current value. Set to 0 to block.
                    </p>
                  </div>
                )}
                {member.status === 'ACTIVE' && (
                  <button
                    onClick={() => handleDisable(member.id)}
                    disabled={actionLoading[member.id]}
                    className="w-full py-1.5 bg-red-50 text-red-600 rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    {actionLoading[member.id] ? 'Disabling...' : 'Disable Member'}
                  </button>
                )}

                {subscriptionSource !== 'stripe' ? (
                  <>
                    {/* Time Bomb */}
                    <div className="pt-2 border-t border-gray-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-600 font-medium">Time Bomb</p>
                        {member.timeBombAt && (
                          <span className="text-xs text-amber-600">💣 {new Date(member.timeBombAt).toLocaleDateString()}</span>
                        )}
                      </div>
                      {member.status === 'GRACE_PERIOD' && (
                        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          ⏳ Grace period — access restricted soon
                        </div>
                      )}
                      {member.status === 'TIME_BOMBED' && (
                        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                          🚫 Access restricted (downgraded to VIEWER)
                        </div>
                      )}
                      {member.timeBombAt ? (
                        <button
                          onClick={() => handleClearTimeBomb(member.id)}
                          disabled={actionLoading[`bomb_${member.id}`]}
                          className="w-full py-1.5 bg-gray-200 text-gray-600 rounded text-xs font-medium hover:bg-gray-300 disabled:opacity-50"
                        >
                          {actionLoading[`bomb_${member.id}`] ? 'Clearing...' : 'Clear Time Bomb'}
                        </button>
                      ) : (
                        <>
                          {!showBombForm[member.id] ? (
                            <button
                              onClick={() => setShowBombForm(p => ({ ...p, [member.id]: true }))}
                              className="w-full py-1.5 bg-gray-200 text-gray-600 rounded text-xs font-medium hover:bg-gray-300"
                            >
                              Set Time Bomb
                            </button>
                          ) : (
                            <div className="space-y-1.5">
                              <div>
                                <label className="block text-xs text-gray-600 mb-0.5">Bomb date</label>
                                <input
                                  type="datetime-local"
                                  value={bombDate[member.id] ?? ''}
                                  onChange={e => setBombDate(p => ({ ...p, [member.id]: e.target.value }))}
                                  className="w-full px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 focus:outline-none focus:border-emerald-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-600 mb-0.5">Grace period (hours)</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={bombGrace[member.id] ?? '24'}
                                  onChange={e => setBombGrace(p => ({ ...p, [member.id]: e.target.value }))}
                                  className="w-full px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 focus:outline-none focus:border-emerald-500"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleSetTimeBomb(member.id)}
                                  disabled={actionLoading[`bomb_${member.id}`]}
                                  className="flex-1 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-500 disabled:opacity-50"
                                >
                                  {actionLoading[`bomb_${member.id}`] ? 'Setting...' : 'Set Bomb'}
                                </button>
                                <button
                                  onClick={() => setShowBombForm(p => ({ ...p, [member.id]: false }))}
                                  className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Trial Period */}
                    <div className="pt-2 border-t border-gray-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-600 font-medium">Trial Period</p>
                        <button
                          onClick={() => setTrialEnabled(p => ({ ...p, [member.id]: !p[member.id] }))}
                          className={`px-2 py-0.5 rounded text-xs font-medium ${trialEnabled[member.id] ? 'bg-amber-600 text-amber-600' : 'bg-gray-200 text-gray-600'}`}
                        >
                          {trialEnabled[member.id] ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>
                      {trialEnabled[member.id] && (
                        <div className="space-y-1.5">
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">Expiry date</label>
                            <input
                              type="date"
                              value={trialDate[member.id] ?? ''}
                              onChange={e => setTrialDate(p => ({ ...p, [member.id]: e.target.value }))}
                              className="w-full px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 focus:outline-none focus:border-emerald-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">Custom message</label>
                            <textarea
                              value={trialMsg[member.id] ?? ''}
                              onChange={e => setTrialMsg(p => ({ ...p, [member.id]: e.target.value }))}
                              placeholder="Your trial has expired. Contact your admin to extend access."
                              rows={2}
                              className="w-full px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500 resize-none"
                            />
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => handleTrialSave(member.id)}
                        disabled={trialLoading[member.id]}
                        className="w-full py-1.5 bg-gray-200 text-gray-600 rounded text-xs font-medium hover:bg-gray-300 disabled:opacity-50"
                      >
                        {trialLoading[member.id] ? 'Saving...' : 'Save Trial Settings'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-gray-600 pt-2 border-t border-gray-200">Team access is managed through your Stripe subscription.</div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

