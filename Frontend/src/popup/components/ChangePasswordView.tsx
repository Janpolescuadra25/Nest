import React, { useState } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toast';

interface Props {
  jwt: string;
  onDone: () => void;
}

export default function ChangePasswordView({ jwt, onDone }: Props) {
  const { showToast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.changePassword(jwt, currentPassword, newPassword);
      showToast('Password updated successfully', 'success');
      onDone();
    } catch (err: any) {
      setError(err.message || 'Failed to change password.');
      showToast('Password change failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center flex-1 p-6">
      <div className="w-full max-w-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Set Your Password</h2>
        <p className="text-sm text-gray-600 mb-5">You must set a new password before continuing.</p>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            placeholder="Temporary Password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            required
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500"
          />
          <input
            type="password"
            placeholder="New Password (min 8 chars)"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            required
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500"
          />
          <input
            type="password"
            placeholder="Confirm New Password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Set Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
