import React, { useState } from 'react';
import { api } from '../lib/api';
import { UserInfo } from '../hooks/useAuth';

type View = 'login' | 'request-access' | 'forgot-password';

interface LoginViewProps {
  onLogin: (user: UserInfo, token: string) => void;
}

export default function LoginView({ onLogin }: LoginViewProps) {
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
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

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.requestAccess(email, name);
      setSuccess("Request submitted! You'll receive an email once approved.");
      setEmail('');
      setName('');
    } catch (err: any) {
      setError(err.message || 'Request failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setSuccess("Reset request submitted! You'll receive an email once approved.");
      setEmail('');
    } catch (err: any) {
      setError(err.message || 'Request failed.');
    } finally {
      setLoading(false);
    }
  };

  if (view === 'request-access') {
    return (
      <div className="p-4">
        <button onClick={() => { setView('login'); setError(''); setSuccess(''); }} className="text-sm text-cyan-400 hover:text-cyan-300 mb-4 block">&larr; Back to Login</button>
        <h2 className="text-lg font-semibold text-white mb-1">Request Access</h2>
        <p className="text-sm text-gray-400 mb-4">Submit your email and the admin will review your request.</p>
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        {success && <p className="text-green-400 text-sm mb-3">{success}</p>}
        <form onSubmit={handleRequestAccess} className="space-y-3">
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500" />
          <input type="text" placeholder="Full Name (optional)" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500" />
          <button type="submit" disabled={loading} className="w-full py-2 bg-cyan-500 text-white rounded-lg text-sm font-medium hover:bg-cyan-600 disabled:opacity-50">
            {loading ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>
      </div>
    );
  }

  if (view === 'forgot-password') {
    return (
      <div className="p-4">
        <button onClick={() => { setView('login'); setError(''); setSuccess(''); }} className="text-sm text-cyan-400 hover:text-cyan-300 mb-4 block">&larr; Back to Login</button>
        <h2 className="text-lg font-semibold text-white mb-1">Forgot Password</h2>
        <p className="text-sm text-gray-400 mb-4">Enter your email and the admin will review your reset request.</p>
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        {success && <p className="text-green-400 text-sm mb-3">{success}</p>}
        <form onSubmit={handleForgotPassword} className="space-y-3">
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500" />
          <button type="submit" disabled={loading} className="w-full py-2 bg-cyan-500 text-white rounded-lg text-sm font-medium hover:bg-cyan-600 disabled:opacity-50">
            {loading ? 'Submitting...' : 'Submit Reset Request'}
          </button>
        </form>
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
      <div className="mt-4 space-y-1">
        <button onClick={() => { setView('request-access'); setError(''); setSuccess(''); }} className="text-sm text-cyan-400 hover:text-cyan-300 block">Request Access</button>
        <button onClick={() => { setView('forgot-password'); setError(''); setSuccess(''); }} className="text-sm text-gray-500 hover:text-gray-400 block">Forgot Password?</button>
      </div>
    </div>
  );
}
