import React, { useState } from 'react';
import { api } from '../lib/api';
import { UserInfo } from '../hooks/useAuth';

type View = 'login' | 'become-partner';

interface LoginViewProps {
  onLogin: (user: UserInfo, token: string) => void;
}

export default function LoginView({ onLogin }: LoginViewProps) {
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.login(email, password);
      onLogin(data.user, data.token);
    } catch (err: any) {
      setError(err.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleBecomePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (description.trim().length < 10) {
      setError('Description must be at least 10 characters.');
      return;
    }
    setLoading(true);
    try {
      await api.submitAdminRequest(email, name, description.trim(), company.trim() || undefined);
      setSuccess("Application submitted! We'll review and get back to you.");
      setEmail('');
      setName('');
      setCompany('');
      setDescription('');
    } catch (err: any) {
      setError(err.message || 'Submission failed.');
    } finally {
      setLoading(false);
    }
  };

  if (view === 'become-partner') {
    return (
      <div className="p-4">
        <button onClick={() => { setView('login'); setError(''); setSuccess(''); }} className="text-sm text-cyan-400 hover:text-cyan-300 mb-4 block">&larr; Back to Login</button>
        <h2 className="text-lg font-semibold text-white mb-1">Become a Nest Partner</h2>
        <p className="text-sm text-gray-400 mb-4">Tell us about yourself and we'll get back to you.</p>
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        {success && <p className="text-green-400 text-sm mb-3">{success}</p>}
        {!success && (
          <form onSubmit={handleBecomePartner} className="space-y-3">
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500" />
            <input type="text" placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} required className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500" />
            <input type="text" placeholder="Company (optional)" value={company} onChange={e => setCompany(e.target.value)} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500" />
            <textarea
              placeholder="Tell us how you plan to use Nest (min. 10 characters)"
              value={description}
              onChange={e => setDescription(e.target.value)}
              required
              rows={3}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 resize-none"
            />
            <button type="submit" disabled={loading} className="w-full py-2 bg-cyan-500 text-white rounded-lg text-sm font-medium hover:bg-cyan-600 disabled:opacity-50">
              {loading ? 'Submitting...' : 'Submit Application'}
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold text-white mb-1">Sign In</h2>
      <p className="text-sm text-gray-400 mb-4">Welcome back to Nest.</p>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      <form onSubmit={handleLogin} className="space-y-3">
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500" />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500" />
        <button type="submit" disabled={loading} className="w-full py-2 bg-cyan-500 text-white rounded-lg text-sm font-medium hover:bg-cyan-600 disabled:opacity-50">
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
      <div className="mt-4">
        <button onClick={() => { setView('become-partner'); setError(''); setSuccess(''); }} className="text-sm text-cyan-400 hover:text-cyan-300 block">Become a Nest Partner</button>
      </div>
    </div>
  );
}
