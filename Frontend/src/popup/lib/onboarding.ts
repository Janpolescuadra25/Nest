import type { QBStatus, TabId } from '../../types';

// CONFIRMED FROM PRE-FLIGHT AUDIT:
// Tab state: currentTab / setCurrentTab, type TabId
// QB connected: via useQuickBooks(jwt) — returns { status, loading, connect, checkStatus }
// Has locations: via useLocations(jwt) — returns { locations, loading, error, refetch }
// Has mappings: api.getMappings(jwt, locId).length > 0
// Has synced: at least one scan record with status 'SYNCED'
// Tab IDs: 'dashboard' | 'settings' | 'locations' | 'mappings' | 'scan' | 'sync' | etc.
// Dashboard: 3 variants — OWNER→DashboardView, ADMIN→AdminDashboard, other→UserDashboard
// Onboarding scope: OWNER only
// NOTE: MappingView.tsx is a barrel re-export; actual component is MappingView/index.tsx

export type OnboardingStep = 1 | 2 | 3 | 4;

export interface OnboardingState {
  step: OnboardingStep | 0;
  completedSteps: number[];
  totalSteps: 4;
}

export function getOnboardingState(params: {
  qbStatus: QBStatus | null;
  hasLocations: boolean;
  hasMappings: boolean;
  hasSynced: boolean;
}): OnboardingState {
  const completed: number[] = [];
  if (params.qbStatus?.connected) completed.push(1);
  if (params.hasLocations) completed.push(2);
  if (params.hasMappings) completed.push(3);
  if (params.hasSynced) completed.push(4);

  if (completed.length === 4) return { step: 0, completedSteps: completed, totalSteps: 4 };

  const nextStep = (completed.length + 1) as OnboardingStep;
  return { step: nextStep, completedSteps: completed, totalSteps: 4 };
}

export const STEP_TAB_MAP: Record<OnboardingStep, TabId> = {
  1: 'settings',
  2: 'locations',
  3: 'mappings',
  4: 'scan',
};

export function getStepLabel(step: OnboardingStep): string {
  const labels: Record<OnboardingStep, string> = {
    1: 'Connect QuickBooks',
    2: 'Add Your First Location',
    3: 'Create a Mapping',
    4: 'Begin Your First Sync',
  };
  return labels[step];
}

export function getStepCTA(step: OnboardingStep): string {
  const ctas: Record<OnboardingStep, string> = {
    1: 'Connect QuickBooks',
    2: 'Add Location',
    3: 'Create Mapping',
    4: 'Begin Sync Pipeline',
  };
  return ctas[step];
}
