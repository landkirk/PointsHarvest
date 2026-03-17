import type { DebugEntry, DomDebug, DailySetDebug, SearchCounterDebug } from './debug.js';
import type { MappedActivity } from './activity.js';
import type { OrchestratorBase } from '../interfaces/orchestrator.js';

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
  mappedActivities:    MappedActivity[];
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
  mappedActivities:     [],
};

let cache: AppState | null = null;

// ── In-memory runtime state (not persisted) ────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOrchestrator = OrchestratorBase<any[]>;

let isActivelyRunning = false;
let activeOrchestrator: AnyOrchestrator | null = null;

export function getIsActivelyRunning(): boolean { return isActivelyRunning; }
export function setIsActivelyRunning(value: boolean): void { isActivelyRunning = value; }

export function getActiveOrchestrator(): AnyOrchestrator | null { return activeOrchestrator; }
export function setActiveOrchestrator(instance: AnyOrchestrator | null): void { activeOrchestrator = instance; }

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
