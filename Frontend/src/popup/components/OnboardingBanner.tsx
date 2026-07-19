import React, { useState, useEffect } from 'react';
import { getStepCTA, STEP_TAB_MAP } from '../lib/onboarding';
import type { OnboardingState } from '../lib/onboarding';
import type { TabId } from '../../types';

interface Props {
  state: OnboardingState;
  onNavigate: (tab: TabId) => void;
}

export function OnboardingBanner({ state, onNavigate }: Props) {
  const [visible, setVisible] = useState(true);
  const dismissKey = `onboarding_dismissed_${state.step}`;

  useEffect(() => {
    chrome.storage.local.get(dismissKey, (result) => {
      if (result[dismissKey]) {
        setVisible(false);
      }
    });
  }, [dismissKey]);

  if (!visible || state.step === 0) return null;

  const ctaLabel = getStepCTA(state.step);
  const progressWidth = `${(state.completedSteps.length / state.totalSteps) * 100}%`;
  const targetTab = STEP_TAB_MAP[state.step];

  return (
    <div className="mx-4 mb-3 rounded-lg bg-emerald-600 p-3 text-white shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold">Step {state.step}/{state.totalSteps}: {ctaLabel}</div>
          <div className="mt-1 text-[11px] text-emerald-100">Complete the quick start flow to sync your first report.</div>
        </div>
        <button
          type="button"
          onClick={() => {
            chrome.storage.local.set({ [dismissKey]: true });
            setVisible(false);
          }}
          className="text-white/60 hover:text-white text-xs"
          aria-label="Dismiss onboarding banner"
        >
          ✕
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onNavigate(targetTab)}
          className="rounded bg-white px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-gray-100"
        >
          {ctaLabel}
        </button>
        <div className="flex-1">
          <div className="h-1 rounded-full bg-white/30">
            <div className="h-1 rounded-full bg-white transition-all" style={{ width: progressWidth }} />
          </div>
        </div>
      </div>
    </div>
  );
}
