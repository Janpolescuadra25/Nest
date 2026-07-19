import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { hasPerm } from '../lib/permissions';
import { useToast } from './Toast';
import { ErrorCard, StatusBadge, PermissionToggle, DashboardSkeleton, EmptyState } from './shared';
import { trialCountdown } from '../lib/utils';
import { BACKEND_URL } from '../../lib/config';
import type { TeamMember, InviteLink } from '../../types';

interface InviteResult {
  user: { id: string; email: string; name: string | null; role: string };
  tempPassword: string;
}

interface Props {
  jwt: string;
  subscriptionSource?: string | null;
}

const ROLE_OPTIONS = ['VIEWER', 'STAFF', 'ACCOUNTANT'];

export default function MyTeamTab({ jwt, subscriptionSource }: Props) {
  const { showToast } = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [showInvite, setShowInvite] = useState(false);
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
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkRoleHint, setLinkRoleHint] = useState('VIEWER');
  const [linkExpiry, setLinkExpiry] = useState('72');
  const [linkMaxUses, setLinkMaxUses] = useState('1');
  const [createdLink, setCreatedLink] = useState<InviteLink | null>(null);

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
      setShowInvite(false);
      await fetchTeam();
      showToast('Invitation sent!', 'success');
    } catch (err: any) {
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
      });
      setCreatedLink(result.invite);
      setLinkRoleHint('VIEWER');
      setLinkExpiry('72');
      setLinkMaxUses('1');
      setShowLinkForm(false);
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

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-white">My Team</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowLinkForm(!showLinkForm)}
            className="text-xs px-2 py-1 bg-slate-700 text-gray-300 rounded hover:bg-slate-600"
          >
            🔗 Link
          </button>
          <button
            onClick={() => setShowInvite(!showInvite)}
            className="text-xs px-2 py-1 bg-emerald-700 text-emerald-200 rounded hover:bg-emerald-600"
          >
            + Invite
          </button>
        </div>
      </div>

      {inviteResult && (
        <div className="bg-green-900/40 border border-green-700 rounded-lg p-3 text-sm">
          <p className="text-green-400 font-medium">Member invited!</p>
          <p className="text-gray-300 text-xs mt-1">Email: <span className="font-mono">{inviteResult.user.email}</span></p>
          <p className="text-gray-300 text-xs">Temp password: <span className="font-mono text-yellow-400">{inviteResult.tempPassword}</span></p>
          <p className="text-gray-500 text-xs mt-1">Share this password securely — they'll be prompted to change it on first login.</p>
          <button onClick={() => setInviteResult(null)} className="mt-2 text-xs text-gray-400 hover:text-gray-300">Dismiss</button>
        </div>
      )}

      {createdLink && (
        <div className="bg-green-900/40 border border-green-700 rounded-lg p-3 text-sm">
          <p className="text-green-400 font-medium">Invite link created!</p>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 text-xs text-gray-300 bg-slate-800 px-2 py-1 rounded break-all">{BACKEND_URL}/api/invite/{createdLink.token}</code>
            <button
              onClick={() => copyToClipboard(`${BACKEND_URL}/api/invite/${createdLink.token}`)}
              className="text-xs px-2 py-1 bg-emerald-700 text-emerald-200 rounded hover:bg-emerald-600 flex-shrink-0"
            >
              Copy
            </button>
          </div>
          <p className="text-gray-500 text-xs mt-1">Share this link — it expires {new Date(createdLink.expiresAt).toLocaleString()}</p>
          <button onClick={() => setCreatedLink(null)} className="mt-2 text-xs text-gray-400 hover:text-gray-300">Dismiss</button>
        </div>
      )}

      {showInvite && (
        <form onSubmit={handleInvite} className="bg-slate-800 rounded-lg p-3 space-y-2">
          <input
            type="email"
            placeholder="Email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            required
            className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
          />
          <input
            type="text"
            placeholder="Name (optional)"
            value={inviteName}
            onChange={e => setInviteName(e.target.value)}
            className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
          />
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
            className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-gray-300 focus:outline-none"
          >
            {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {subscriptionSource !== 'stripe' ? (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Trial period (days)</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  placeholder="e.g. 30"
                  value={inviteTrialDays}
                  onChange={e => setInviteTrialDays(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Expiry message (shown to user when trial ends)</label>
                <textarea
                  placeholder="e.g. Contact me to renew your access"
                  value={inviteExpiryMsg}
                  onChange={e => setInviteExpiryMsg(e.target.value)}
                  maxLength={200}
                  rows={2}
                  className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>
            </>
          ) : (
            <div className="text-xs text-gray-400">Team access is managed through your Stripe subscription.</div>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={actionLoading['invite']} className="flex-1 py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-500 disabled:opacity-50">
              {actionLoading['invite'] ? 'Inviting...' : 'Send Invite'}
            </button>
            <button type="button" onClick={() => setShowInvite(false)} className="px-3 py-1.5 bg-slate-700 text-gray-400 rounded text-xs hover:bg-slate-600">
              Cancel
            </button>
          </div>
        </form>
      )}

      {showLinkForm && (
        <form onSubmit={handleCreateLink} className="bg-slate-800 rounded-lg p-3 space-y-2">
          <p className="text-xs text-gray-400 font-medium">Create Invite Link</p>
          <select
            value={linkRoleHint}
            onChange={e => setLinkRoleHint(e.target.value)}
            className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-gray-300 focus:outline-none"
          >
            {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-0.5">Expires (hours)</label>
              <input
                type="number"
                min={1}
                max={720}
                value={linkExpiry}
                onChange={e => setLinkExpiry(e.target.value)}
                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-0.5">Max uses</label>
              <input
                type="number"
                min={1}
                max={100}
                value={linkMaxUses}
                onChange={e => setLinkMaxUses(e.target.value)}
                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={actionLoading['linkCreate']} className="flex-1 py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-500 disabled:opacity-50">
              {actionLoading['linkCreate'] ? 'Creating...' : 'Create Link'}
            </button>
            <button type="button" onClick={() => setShowLinkForm(false)} className="px-3 py-1.5 bg-slate-700 text-gray-400 rounded text-xs hover:bg-slate-600">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Invite Links List */}
      {inviteLinks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 font-medium">Invite Links</p>
          {inviteLinks.map(link => (
            <div key={link.id} className="bg-slate-800 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-300">{link.roleHint}</span>
                  <span className={`text-xs px-1 py-0.5 rounded ${link.isActive ? 'bg-green-900 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                    {link.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  Uses: {link.useCount}/{link.maxUses} · Expires: {new Date(link.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => handleRevokeLink(link.id)}
                disabled={actionLoading[`revoke_${link.id}`]}
                className="text-xs px-2 py-1 bg-red-900 text-red-300 rounded hover:bg-red-800 disabled:opacity-50 flex-shrink-0"
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
          action={{ label: 'Invite member', onClick: () => setShowInvite(true) }}
        />
      ) : (
        members.map(member => (
          <div key={member.id} className="bg-slate-800 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">{member.name ?? member.email}</div>
                {member.name && <div className="text-xs text-gray-400 truncate">{member.email}</div>}
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-xs text-gray-500">{member.role}</span>
                  <StatusBadge status={member.blocked ? 'BLOCKED' : member.status} />
                  {effectiveBadge(member)}
                  {member.mustChangePassword && <span className="text-xs text-yellow-500">⚠ needs pw change</span>}
                  {trialCountdown(member.trialExpiresAt)}
                </div>
              </div>
              <button onClick={() => handleExpandMember(member)} className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0">
                {expandedId === member.id ? '▲' : '▼'}
              </button>
            </div>
            {expandedId === member.id && (
              <div className="pt-2 border-t border-slate-700 space-y-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Role</p>
                  <div className="flex gap-1 flex-wrap">
                    {ROLE_OPTIONS.map(r => (
                      <button
                        key={r}
                        onClick={() => handleRoleChange(member.id, r)}
                        disabled={actionLoading[`role_${member.id}`] || member.role === r}
                        className={`px-2 py-0.5 rounded text-xs disabled:opacity-50 ${member.role === r ? 'bg-emerald-700 text-emerald-200' : 'bg-slate-700 text-gray-400 hover:bg-slate-600'}`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Permissions</p>
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
                {member.status === 'ACTIVE' && (
                  <button
                    onClick={() => handleDisable(member.id)}
                    disabled={actionLoading[member.id]}
                    className="w-full py-1.5 bg-red-900 text-red-300 rounded text-xs font-medium hover:bg-red-800 disabled:opacity-50"
                  >
                    {actionLoading[member.id] ? 'Disabling...' : 'Disable Member'}
                  </button>
                )}

                {subscriptionSource !== 'stripe' ? (
                  <>
                    {/* Time Bomb */}
                    <div className="pt-2 border-t border-slate-700 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-400 font-medium">Time Bomb</p>
                        {member.timeBombAt && (
                          <span className="text-xs text-yellow-400">💣 {new Date(member.timeBombAt).toLocaleDateString()}</span>
                        )}
                      </div>
                      {member.status === 'GRACE_PERIOD' && (
                        <div className="text-xs text-yellow-300 bg-yellow-900/30 border border-yellow-800 rounded px-2 py-1">
                          ⏳ Grace period — access restricted soon
                        </div>
                      )}
                      {member.status === 'TIME_BOMBED' && (
                        <div className="text-xs text-red-300 bg-red-900/30 border border-red-800 rounded px-2 py-1">
                          🚫 Access restricted (downgraded to VIEWER)
                        </div>
                      )}
                      {member.timeBombAt ? (
                        <button
                          onClick={() => handleClearTimeBomb(member.id)}
                          disabled={actionLoading[`bomb_${member.id}`]}
                          className="w-full py-1.5 bg-slate-700 text-gray-300 rounded text-xs font-medium hover:bg-slate-600 disabled:opacity-50"
                        >
                          {actionLoading[`bomb_${member.id}`] ? 'Clearing...' : 'Clear Time Bomb'}
                        </button>
                      ) : (
                        <>
                          {!showBombForm[member.id] ? (
                            <button
                              onClick={() => setShowBombForm(p => ({ ...p, [member.id]: true }))}
                              className="w-full py-1.5 bg-slate-700 text-gray-300 rounded text-xs font-medium hover:bg-slate-600"
                            >
                              Set Time Bomb
                            </button>
                          ) : (
                            <div className="space-y-1.5">
                              <div>
                                <label className="block text-xs text-gray-500 mb-0.5">Bomb date</label>
                                <input
                                  type="datetime-local"
                                  value={bombDate[member.id] ?? ''}
                                  onChange={e => setBombDate(p => ({ ...p, [member.id]: e.target.value }))}
                                  className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-emerald-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 mb-0.5">Grace period (hours)</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={bombGrace[member.id] ?? '24'}
                                  onChange={e => setBombGrace(p => ({ ...p, [member.id]: e.target.value }))}
                                  className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-emerald-500"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleSetTimeBomb(member.id)}
                                  disabled={actionLoading[`bomb_${member.id}`]}
                                  className="flex-1 py-1.5 bg-yellow-800 text-yellow-200 rounded text-xs font-medium hover:bg-yellow-700 disabled:opacity-50"
                                >
                                  {actionLoading[`bomb_${member.id}`] ? 'Setting...' : 'Set Bomb'}
                                </button>
                                <button
                                  onClick={() => setShowBombForm(p => ({ ...p, [member.id]: false }))}
                                  className="px-3 py-1.5 bg-slate-700 text-gray-400 rounded text-xs hover:bg-slate-600"
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
                    <div className="pt-2 border-t border-slate-700 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-400 font-medium">Trial Period</p>
                        <button
                          onClick={() => setTrialEnabled(p => ({ ...p, [member.id]: !p[member.id] }))}
                          className={`px-2 py-0.5 rounded text-xs font-medium ${trialEnabled[member.id] ? 'bg-yellow-800 text-yellow-300' : 'bg-slate-700 text-gray-500'}`}
                        >
                          {trialEnabled[member.id] ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>
                      {trialEnabled[member.id] && (
                        <div className="space-y-1.5">
                          <div>
                            <label className="block text-xs text-gray-500 mb-0.5">Expiry date</label>
                            <input
                              type="date"
                              value={trialDate[member.id] ?? ''}
                              onChange={e => setTrialDate(p => ({ ...p, [member.id]: e.target.value }))}
                              className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-emerald-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-0.5">Custom message</label>
                            <textarea
                              value={trialMsg[member.id] ?? ''}
                              onChange={e => setTrialMsg(p => ({ ...p, [member.id]: e.target.value }))}
                              placeholder="Your trial has expired. Contact your admin to extend access."
                              rows={2}
                              className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 resize-none"
                            />
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => handleTrialSave(member.id)}
                        disabled={trialLoading[member.id]}
                        className="w-full py-1.5 bg-slate-700 text-gray-300 rounded text-xs font-medium hover:bg-slate-600 disabled:opacity-50"
                      >
                        {trialLoading[member.id] ? 'Saving...' : 'Save Trial Settings'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-gray-400 pt-2 border-t border-slate-700">Team access is managed through your Stripe subscription.</div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

