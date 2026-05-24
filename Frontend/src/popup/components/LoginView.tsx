import React, { useState } from 'react';
import { api } from '../lib/api';

interface Props {
  onLogin: (jwt: string) => void;
}

type Step = 'email' | 'otp';

export default function LoginView({ onLogin }: Props) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.login(email.trim());
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { token } = await api.verify(email.trim(), code.trim());
      onLogin(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center bg-gray-900 text-white" style={{ width: 380, height: 500 }}>
      {/* Logo */}
      <div className="mb-6 text-center">
        <div className="text-4xl font-black text-cyan-400 tracking-tight">Nest</div>
        <div className="text-gray-500 text-xs mt-1">Toast → QuickBooks</div>
      </div>

      <div className="w-72 bg-gray-800 rounded-xl p-5 border border-gray-700">
        {step === 'email' ? (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-gray-900 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-cyan-500 focus:outline-none"
                autoFocus
                required
              />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {loading ? 'Sending…' : 'Send Code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <p className="text-xs text-gray-400 mb-3">
                Check server logs for the 6-digit code sent to{' '}
                <span className="text-white">{email}</span>
              </p>
              <label className="block text-xs text-gray-400 mb-1">Verification code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                maxLength={6}
                className="w-full bg-gray-900 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-cyan-500 focus:outline-none tracking-widest text-center"
                autoFocus
                required
              />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {loading ? 'Verifying…' : 'Verify & Login'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('email'); setCode(''); setError(null); }}
              className="w-full text-gray-500 text-xs hover:text-gray-300"
            >
              ← Change email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
