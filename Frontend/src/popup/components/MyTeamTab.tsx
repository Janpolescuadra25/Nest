import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toast';
import { trialCountdown } from '../lib/utils';
import type { TeamMember } from '../../types';

interface InviteResult {
  user: { id: string; email: string; name: string | null; role: string };
  tempPassword: string;
}

interface Props {
  jwt: string;
}

const ROLE_OPTIONS = ['VIEWER', 'STAFF', 'ACCOUNTANT'];

export default function MyTeamTab({ jwt }: Props) {
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // trial editing: keyed by member id
  const [trialEnabled, setTrialEnabled] = useState<Record<string, boolean>>({});
  const [trialDate, setTrialDate] = useState<Record<string, string>>({});
  const [trialMsg, setTrialMsg] = useState<Record<string, string>>({});
  const [trialLoading, setTrialLoading] = useState<Record<string, boolean>>({});

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

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(p => ({ ...p, invite: true }));
    setError('');
    try {
      const result = await api.inviteTeamMember(jwt, inviteEmail, inviteRole, inviteName || undefined);
      setInviteResult(result);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('STAFF');
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

  const handlePatchPerm = async (id: string, field: string, value: boolean) => {
    setActionLoading(p => ({ ...p, [`p_${id}_${field}`]: true }));
    try {
      await api.patchTeamMember(jwt, id, { [field]: value });
      await fetchTeam();
      showToast('Member updated', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to update permission.');
      showToast('Update failed', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`p_${id}_${field}`]: false }));
    }
  };

  const handleRoleChange = async (id: string, role: string) => {
    setActionLoading(p => ({ ...p, [`role_${id}`]: true }));
    try {
      await api.patchTeamMember(jwt, id, { role });
      await fetchTeam();
      showToast('Member updated', 'success');
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
      // Initialise trial state from current data
      const hasTrial = !!member.trialExpiresAt;
      setTrialEnabled(p => ({ ...p, [member.id]: hasTrial }));
      setTrialDate(p => ({
        ...p,
        [member.id]: member.trialExpiresAt ? member.trialExpiresAt.slice(0, 10) : '',
      }));
      setTrialMsg(p => ({ ...p, [member.id]: member.customExpiryMessage ?? '' }));
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


  const PermToggle = ({ memberId, field, value, label }: { memberId: string; field: string; value: boolean; label: string }) => (
    <button
      onClick={() => handlePatchPerm(memberId, field, !value)}
      disabled={actionLoading[`p_${memberId}_${field}`]}
      className={`px-2 py-0.5 rounded text-xs disabled:opacity-50 ${value ? 'bg-cyan-800 text-cyan-300' : 'bg-slate-700 text-gray-500'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-white">My Team</h2>
        <button
          onClick={() => setShowInvite(!showInvite)}
          className="text-xs px-2 py-1 bg-cyan-700 text-cyan-200 rounded hover:bg-cyan-600"
        >
          + Invite
        </button>
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

      {showInvite && (
        <form onSubmit={handleInvite} className="bg-slate-800 rounded-lg p-3 space-y-2">
          <input
            type="email"
            placeholder="Email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            required
            className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
          />
          <input
            type="text"
            placeholder="Name (optional)"
            value={inviteName}
            onChange={e => setInviteName(e.target.value)}
            className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
          />
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
            className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-gray-300 focus:outline-none"
          >
            {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="submit" disabled={actionLoading['invite']} className="flex-1 py-1.5 bg-cyan-600 text-white rounded text-xs font-medium hover:bg-cyan-500 disabled:opacity-50">
              {actionLoading['invite'] ? 'Inviting...' : 'Send Invite'}
            </button>
            <button type="button" onClick={() => setShowInvite(false)} className="px-3 py-1.5 bg-slate-700 text-gray-400 rounded text-xs hover:bg-slate-600">
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : members.length === 0 ? (
        <p className="text-gray-500 text-sm">No team members yet. Invite someone!</p>
      ) : (
        members.map(member => (
          <div key={member.id} className="bg-slate-800 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">{member.name ?? member.email}</div>
                {member.name && <div className="text-xs text-gray-400 truncate">{member.email}</div>}
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-gray-500">{member.role}</span>
                  <span className={`text-xs px-1 py-0.5 rounded ${member.status === 'ACTIVE' ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'}`}>
                    {member.status}
                  </span>
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
                        className={`px-2 py-0.5 rounded text-xs disabled:opacity-50 ${member.role === r ? 'bg-cyan-700 text-cyan-200' : 'bg-slate-700 text-gray-400 hover:bg-slate-600'}`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Permissions</p>
                  <div className="flex gap-1 flex-wrap">
                    <PermToggle memberId={member.id} field="canScan" value={member.canScan} label="Scan" />
                    <PermToggle memberId={member.id} field="canMap" value={member.canMap} label="Map" />
                    <PermToggle memberId={member.id} field="canSync" value={member.canSync} label="Sync" />
                    <PermToggle memberId={member.id} field="canManageLocs" value={member.canManageLocs} label="Locations" />
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
                          className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">Custom message</label>
                        <textarea
                          value={trialMsg[member.id] ?? ''}
                          onChange={e => setTrialMsg(p => ({ ...p, [member.id]: e.target.value }))}
                          placeholder="Your trial has expired. Contact your admin to extend access."
                          rows={2}
                          className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 resize-none"
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
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
