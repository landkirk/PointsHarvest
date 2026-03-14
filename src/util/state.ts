import type { DebugEntry, DomDebug, DailySetDebug, SearchCounterDebug } from './debug.js';
import type { Activity, MappedActivity } from './activity.js';
import type { Tile } from '../steps/validate-tile.js';

// ── Ephemeral session ──────────────────────────────────────────────────────
// In-memory only. Resets whenever the service worker restarts.

export interface Session {
  pendingTabId:            number | null;
  pendingResolve:          (() => void) | null;
  resolveActivities:       ((result: ActivitiesResult) => void) | null;
  captureNextTabResolve:   ((tab: chrome.tabs.Tab) => void) | null;
  openedTabIds:            Set<number>;
  isActivelyRunning:       boolean;
  rewardsTabId:            number | null;
  breakdownTabId:          number | null;
  lingerTabId:             number | null;
  lingerResolve:           (() => void) | null;
}

export interface ActivitiesResult {
  activities:      Activity[];
  domDebug:        DomDebug | null;
  dailySets?:      Tile[];
  dailySetDebug?:  DailySetDebug | null;
  loggedIn:        boolean;
}

const INITIAL_SESSION: Session = {
  pendingTabId:           null,
  pendingResolve:         null,
  resolveActivities:      null,
  captureNextTabResolve:  null,
  openedTabIds:           new Set(),
  isActivelyRunning:      false,
  rewardsTabId:           null,
  breakdownTabId:         null,
  lingerTabId:            null,
  lingerResolve:          null,
};

export const session: Session = { ...INITIAL_SESSION, openedTabIds: new Set() };

/** Reset all session fields to their initial values. Call at the start of each run. */
export function resetSession(): void {
  Object.assign(session, INITIAL_SESSION, { openedTabIds: new Set() });
}

// ── Persistent store ───────────────────────────────────────────────────────
// Backed by chrome.storage.local. Survives service worker restarts.

export interface SearchCounter {
  type:    string;
  current: number;
  max:     number;
}

export interface AppState {
  isRunning:           boolean;
  isLingering:         boolean;
  status:              string;
  currentIndex:        number;
  completedSearches:   number;
  totalSearches:       number;
  lastRunDate:         string | null;
  lastLabel:           string;
  debugLog:            DebugEntry[];
  domDebug:            DomDebug | null;
  dailySetDebug:       DailySetDebug | null;
  searchCounters:      SearchCounter[];
  searchCounterDebug:  SearchCounterDebug | null;
  extractedActivities: Activity[];
  mappedActivities:    MappedActivity[];
  searchQueue:         string[];
}

export const INITIAL_STATE: AppState = {
  isRunning:            false,
  isLingering:          false,
  status:               'idle',
  currentIndex:         0,
  completedSearches:    0,
  totalSearches:        0,
  lastRunDate:          null,
  lastLabel:            '',
  debugLog:             [],
  domDebug:             null,
  dailySetDebug:        null,
  searchCounters:       [],
  searchCounterDebug:   null,
  extractedActivities:  [],
  mappedActivities:     [],
  searchQueue:          [],
};

let cache: AppState | null = null;

/** Load from storage into cache. Returns the loaded state. */
export async function loadState(): Promise<AppState> {
  const stored = await chrome.storage.local.get(null);
  cache = { ...INITIAL_STATE, ...stored } as AppState;
  return cache;
}

/** Write updates to both the cache and storage. */
export async function setState(updates: Partial<AppState>): Promise<void> {
  if (!cache) cache = { ...INITIAL_STATE };
  Object.assign(cache, updates);
  await chrome.storage.local.set(updates);
}

/** Reset all persistent state to initial values, with optional overrides applied atomically. */
export async function resetState(overrides: Partial<AppState> = {}): Promise<void> {
  cache = { ...INITIAL_STATE, ...overrides };
  await chrome.storage.local.set(cache);
}
