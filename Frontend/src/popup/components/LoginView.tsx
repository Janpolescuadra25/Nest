import React, { useState } from 'react';
import { api } from '../lib/api';

interface LoginViewProps {
  onLogin: (user: any, token: string) => void;
}

export default function LoginView({ onLogin }: LoginViewProps) {
  const [view, setView] = useState<'sign-in' | 'sign-up' | 'forgot-password'>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const resetForm = () => {
    setError('');
    setLoading(false);
    setResetLoading(false);
    setResetSent(false);
  };

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.login(email, password);
      onLogin(data.user, data.token);
    } catch (err: any) {
      setError(err?.message || 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const data = await api.register(name, email, password);
      onLogin(data.user, data.token);
    } catch (err: any) {
      setError(err?.message || 'Unable to create account.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setResetLoading(true);
    try {
      await api.requestPasswordReset(resetEmail);
      setResetSent(true);
    } catch (err: any) {
      setError(err?.message || 'Unable to send reset link.');
    } finally {
      setResetLoading(false);
    }
  };

  const renderTabs = () => (
    <div className="mb-6 flex overflow-hidden rounded-3xl border border-gray-200 bg-gray-100 shadow-sm">
      {['sign-in', 'sign-up'].map((tab) => {
        const active = view === tab;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setView(tab as typeof view);
              resetForm();
            }}
            className={`flex-1 px-4 py-3 text-sm ${active ? 'border-b-2 border-emerald-500 text-emerald-600 font-semibold bg-white' : 'text-gray-400'}`}
          >
            {tab === 'sign-in' ? 'Sign In' : 'Sign Up'}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F5F5F7] p-4 text-gray-900">
      <div className="mx-auto flex max-w-md flex-col py-12">
        <div className="animate-fadeIn rounded-3xl bg-white p-6 shadow-xl shadow-slate-200/40">

          <div className="mb-6 flex flex-col items-center">
            <img src="/public/icons/autobooks-logo.png" alt="AutoBooks" className="h-12 w-12" />
            <p className="mt-2 text-base font-semibold text-gray-900">AutoBooks</p>
            <p className="text-xs text-gray-400">Bookkeeping, simplified.</p>
          </div>
          {renderTabs()}
          {view === 'forgot-password' ? (
            <div>
              <button
                type="button"
                onClick={() => {
                  setView('sign-in');
                  resetForm();
                }}
                className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
                Back to Sign In
              </button>
              <h2 className="text-2xl font-semibold text-gray-900">Forgot Password</h2>
              <p className="mt-2 text-sm text-gray-500">Enter your email and we'll send a reset link.</p>
              <form onSubmit={handleForgotPassword} className="mt-6 space-y-4">
                <input
                  type="email"
                  placeholder="Email address"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  disabled={resetLoading}
                  required
                  className="w-full rounded-2xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-900 outline-none focus:border-emerald-500"
                />
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="w-full rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
                >
                  {resetLoading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>
              {resetSent && (
                <div className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700">
                  <div className="mb-2 flex items-center gap-2 text-emerald-600">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                    Check your email
                  </div>
                  <p>We sent a password reset link to your inbox.</p>
                </div>
              )}
            </div>
          ) : view === 'sign-up' ? (
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">Create your account</h2>
              <p className="mt-2 text-sm text-gray-500">Get started with AutoBooks in minutes.</p>
              <form onSubmit={handleSignUp} className="mt-6 space-y-4">
                <input
                  type="text"
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                  required
                  className="w-full rounded-2xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-900 outline-none focus:border-emerald-500"
                />
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  required
                  className="w-full rounded-2xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-900 outline-none focus:border-emerald-500"
                />
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    required
                    className="w-full rounded-2xl border border-gray-200 bg-gray-100 px-4 py-3 pr-12 text-sm text-gray-900 outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 10-6 0 3 3 0 006 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Confirm Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                    required
                    className="w-full rounded-2xl border border-gray-200 bg-gray-100 px-4 py-3 pr-12 text-sm text-gray-900 outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((current) => !current)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 10-6 0 3 3 0 006 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
                >
                  {loading ? 'Creating account...' : 'Create Account'}
                </button>
              </form>
            </div>
          ) : (
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">Sign In</h2>
              <p className="mt-2 text-sm text-gray-500">Sign in to your AutoBooks account.</p>
              <form onSubmit={handleSignIn} className="mt-6 space-y-4">
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  required
                  className="w-full rounded-2xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-900 outline-none focus:border-emerald-500"
                />
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    required
                    className="w-full rounded-2xl border border-gray-200 bg-gray-100 px-4 py-3 pr-12 text-sm text-gray-900 outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 10-6 0 3 3 0 006 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
                >
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>
              <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
                <button
                  type="button"
                  onClick={() => {
                    setView('forgot-password');
                    resetForm();
                  }}
                  className="text-emerald-600 hover:text-emerald-700"
                >
                  Forgot password?
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setView('sign-up');
                    resetForm();
                  }}
                  className="text-emerald-600 hover:text-emerald-700"
                >
                  Create account
                </button>
              </div>
            </div>
          )}
          {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  );
}
