import { ACTIVITY_TYPE } from './activity-types.js';
import type { ActivityType } from './activity-types.js';

export type PhaseKey = 'warmup' | 'explore' | 'daily' | 'more-activities' | 'farm' | 'claim';

export type Cadence = '' | 'daily' | 'weekly';

export interface PhaseDefinition {
  key: PhaseKey;
  label: string;
  cadence: Cadence;
  timeLabel: string;
  activityType: ActivityType | null;
}

// Single ordered registry — iteration order = phase execution order.
export const PHASE = {
  WARMUP: {
    key: 'warmup',
    label: 'Warm-up',
    cadence: '',
    timeLabel: '',
    activityType: null,
  },
  EXPLORE: {
    key: 'explore',
    label: 'Explore on Bing',
    cadence: 'weekly',
    timeLabel: 'this week',
    activityType: ACTIVITY_TYPE.EXPLORE_ON_BING,
  },
  DAILY: {
    key: 'daily',
    label: 'Daily Sets',
    cadence: 'daily',
    timeLabel: 'today',
    activityType: ACTIVITY_TYPE.DAILY_SET,
  },
  MORE_ACTIVITIES: {
    key: 'more-activities',
    label: 'More Activities',
    cadence: 'weekly',
    timeLabel: 'this week',
    activityType: ACTIVITY_TYPE.MORE_ACTIVITIES,
  },
  FARM: {
    key: 'farm',
    label: 'PC Searches',
    cadence: 'daily',
    timeLabel: 'today',
    activityType: null,
  },
  // Cadence '' on purpose: claimed points were already counted by the phase
  // that earned them, so they must stay out of the daily/weekly headline sums.
  CLAIM: {
    key: 'claim',
    label: 'Claim points',
    cadence: '',
    timeLabel: 'claimed',
    activityType: null,
  },
} as const satisfies Record<string, PhaseDefinition>;

// Must mirror the orchestrator chain in managers/start-run.ts — the popup and
// run summary build their phase rows from this array.
export const PHASES: readonly PhaseDefinition[] = [
  PHASE.WARMUP,
  PHASE.DAILY,
  PHASE.EXPLORE,
  PHASE.MORE_ACTIVITIES,
  PHASE.FARM,
  PHASE.CLAIM,
];

export const PHASES_BY_KEY: Readonly<Record<PhaseKey, PhaseDefinition>> = Object.fromEntries(
  PHASES.map((p) => [p.key, p]),
) as Record<PhaseKey, PhaseDefinition>;

export const PHASE_KEYS: readonly PhaseKey[] = PHASES.map((p) => p.key);

export function phaseForActivityType(t: ActivityType): PhaseDefinition | null {
  return PHASES.find((p) => p.activityType === t) ?? null;
}

export function phasesByCadence(c: Cadence): PhaseDefinition[] {
  return PHASES.filter((p) => p.cadence === c);
}

// ── Runtime state ─────────────────────────────────────────────────────────

export interface PhaseProgress {
  done: number;
  total: number;
}

export interface PhaseRuntimeState {
  progress: PhaseProgress | null;
  points: number;
}

export type PhaseStates = Record<PhaseKey, PhaseRuntimeState>;

export const INITIAL_PHASE_STATES: PhaseStates = Object.fromEntries(
  PHASE_KEYS.map((k) => [k, { progress: null, points: 0 }]),
) as PhaseStates;
