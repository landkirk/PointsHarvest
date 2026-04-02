import type { PhaseKey, PhaseProgress, PhaseProgressMap, PhasePointsMap } from './persistent-state.js';
import type { DebugEntry } from './debug.js';
import type { Failure } from './failures.js';

export type { PhaseKey, PhaseProgressMap };

/** Orchestrator → updateHeader input. */
export interface ProgressPayload {
  headerMessage: string;
  activePhase: PhaseKey | null;
  phaseProgress: PhaseProgress;
  phasePoints: Partial<PhasePointsMap>;
}

/** Background → Popup broadcast (merged state). */
export interface ProgressBroadcast {
  headerMessage: string;
  activePhase: PhaseKey | null;
  phases: PhaseProgressMap;
  phasePoints: PhasePointsMap;
}

import type { RawCard } from './activity.js';
import type { AppState } from './persistent-state.js';

// ── Message actions ────────────────────────────────────────────────────────

export const MSG_ACTION = {
  // Background ↔ rewards content script
  START_EXTRACT: 'startExtract',
  ACTIVITIES_FOUND: 'activitiesFound',
  CLICK_CARD: 'clickCard',
  VALIDATE_ACTIVITY: 'validateActivity',
  // Background ↔ search content script
  PERFORM_SEARCH: 'performSearch',
  // Popup → background
  START: 'start',
  STOP: 'stop',
  GET_STATE: 'getState',
  PING: 'ping',
  PURGE: 'purgeState',
  // Background/steps → popup
  PROGRESS: 'progress',
  DEBUG_ENTRY: 'debugEntry',
  // Popup → background
  USER_ACTION_COMPLETE: 'userActionComplete',
  RESET_STALE: 'resetStale',
  SET_PREFERENCE: 'setPreference',
  // Background → rewards content script (counter extraction)
  GET_COUNTERS: 'getCounters',
  FAILURE_ENTRY: 'failureEntry',
} as const;

export type MsgAction = (typeof MSG_ACTION)[keyof typeof MSG_ACTION];

// ── Discriminated union message types ─────────────────────────────────────

export type AppMessage =
  // Popup → Background
  | { action: typeof MSG_ACTION.START; skipWarmUp?: boolean }
  | { action: typeof MSG_ACTION.STOP }
  | { action: typeof MSG_ACTION.GET_STATE }
  | { action: typeof MSG_ACTION.PING }
  | { action: typeof MSG_ACTION.PURGE }
  | { action: typeof MSG_ACTION.USER_ACTION_COMPLETE }
  | { action: typeof MSG_ACTION.RESET_STALE }
  | {
      action: typeof MSG_ACTION.SET_PREFERENCE;
      updates: Partial<Pick<AppState, 'skipWarmUp' | 'ignoredUpdateVersion'>>;
    }
  // Background → Popup (broadcast)
  | ({ action: typeof MSG_ACTION.PROGRESS } & ProgressBroadcast)
  | { action: typeof MSG_ACTION.DEBUG_ENTRY; entry: DebugEntry }
  | { action: typeof MSG_ACTION.FAILURE_ENTRY; failure: Failure }
  // Background ↔ Rewards content script
  | { action: typeof MSG_ACTION.START_EXTRACT }
  | {
      action: typeof MSG_ACTION.ACTIVITIES_FOUND;
      cards: RawCard[];
      loggedIn: boolean;
    }
  | { action: typeof MSG_ACTION.CLICK_CARD; id: string }
  | { action: typeof MSG_ACTION.VALIDATE_ACTIVITY; id: string }
  | { action: typeof MSG_ACTION.GET_COUNTERS }
  // Background → Search content script
  | { action: typeof MSG_ACTION.PERFORM_SEARCH; query: string };
