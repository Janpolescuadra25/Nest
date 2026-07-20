import React, { useEffect, useCallback } from 'react';
import type { UserInfo } from '../lib/api';
import { api } from '../lib/api';

interface WelcomeOverlayProps {
  user: UserInfo;
  jwt: string;
  onDismiss: () => void;
}

const roleSteps: Record<string, string[]> = {
  OWNER: [
    'Connect your QuickBooks account',
    'Add your store locations',
    'Create scan mappings',
    'Scan your first report',
  ],
  ADMIN: [
    'Check your team\'s QuickBooks connection',
    'Review your assigned locations',
    'Start scanning reports',
  ],
  VIEWER: [
    'Explore the dashboard',
    'Check your team\'s sync status',
  ],
};

export default function WelcomeOverlay({ user, jwt, onDismiss }: WelcomeOverlayProps) {
  const steps = roleSteps[user.role] ?? roleSteps.VIEWER;

  const markSeen = useCallback(async () => {
    try {
      await api.markWelcomeSeen(jwt);
      onDismiss();
    } catch (err) {
      console.error('Failed to mark welcome seen:', err);
      onDismiss();
    }
  }, [jwt, onDismiss]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void markSeen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [markSeen]);

  return (
    <div
      className="fixed inset-0 z-50 bg-white/95 flex items-center justify-center p-4"
      onClick={markSeen}
    >
      <div
        className="max-w-md w-full rounded-3xl border border-gray-200 bg-white shadow-xl p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4">
          <div className="text-emerald-600 font-bold text-sm uppercase tracking-wide">Nest</div>
          <h1 className="mt-3 text-2xl font-semibold text-gray-900">Welcome to Nest!</h1>
          <p className="mt-2 text-sm text-gray-500">
            Scan POS reports and sync them to QuickBooks Online in seconds.
          </p>
        </div>

        <div className="space-y-3 mb-6">
          {steps.map((step, index) => (
            <div key={step} className="flex gap-3 items-start rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white font-semibold text-sm">
                {index + 1}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{step}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={markSeen}
          className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}
