export interface ProgressPayload {
  status?: string;
  completedSearches?: number;
  totalSearches?: number;
  lastSearchString?: string;
}

// ── Debug payload types ────────────────────────────────────────────────────

export type DebugType = 'info' | 'warn' | 'error' | 'success';

export interface DebugEntry {
  time: string;
  type: DebugType;
  message: string;
  orchestrator?: string;
}

// ── Failure payload types ──────────────────────────────────────────────────

export type FailureCategory = 'navigation' | 'search' | 'validation' | 'counter' | 'setup';

export interface Failure {
  time: string;
  category: FailureCategory;
  message: string;
  orchestrator?: string;
}

import type { ActivityType, Activity } from './activity.js';

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
  COMPLETE: 'complete',
  PROGRESS: 'progress',
  ACTIVITIES_MAPPED: 'activitiesMapped',
  DEBUG_ENTRY: 'debugEntry',
  LINGER_WAITING: 'lingerWaiting',
  // Popup → background
  USER_ACTION_COMPLETE: 'userActionComplete',
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
  // Background → Popup (broadcast)
  | { action: typeof MSG_ACTION.COMPLETE }
  | ({ action: typeof MSG_ACTION.PROGRESS } & ProgressPayload)
  | { action: typeof MSG_ACTION.ACTIVITIES_MAPPED }
  | { action: typeof MSG_ACTION.DEBUG_ENTRY; entry: DebugEntry }
  | { action: typeof MSG_ACTION.LINGER_WAITING }
  | { action: typeof MSG_ACTION.FAILURE_ENTRY; failure: Failure }
  // Background ↔ Rewards content script
  | { action: typeof MSG_ACTION.START_EXTRACT }
  | {
      action: typeof MSG_ACTION.ACTIVITIES_FOUND;
      activities: Activity[];
      dailySets?: Activity[];
      loggedIn: boolean;
      domDebug?: unknown;
      dailySetDebug?: unknown;
    }
  | { action: typeof MSG_ACTION.CLICK_CARD; index: number; target?: ActivityType }
  | { action: typeof MSG_ACTION.VALIDATE_ACTIVITY; index: number; target?: ActivityType }
  | { action: typeof MSG_ACTION.GET_COUNTERS }
  // Background → Search content script
  | { action: typeof MSG_ACTION.PERFORM_SEARCH; query: string };
