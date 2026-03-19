import type { DebugEntry, ActivityScan } from './debug.js';
import type { MappedActivity } from './activity.js';
import type { OrchestratorBase } from '../interfaces/orchestrator.js';

// ── Persistent store ───────────────────────────────────────────────────────
// Backed by chrome.storage.local. Survives service worker restarts.

export const PC_SEARCH_TYPE = 'pc search';

export interface SearchCounter {
  type:    string;
  current: number;
  max:     number;
}

export interface AppHeaderState {
  status:            string;
  completedSearches: number;
  totalSearches:     number;
  lastSearchString:  string;
}

export interface AppDebugState {
  debugLog:      DebugEntry[];
  domDebug:      ActivityScan | null;
  dailySetDebug: ActivityScan | null;
}

export interface AppState {
  isRunning:        boolean;
  isLingering:      boolean;
  currentIndex:     number;
  lastRunDate:      string | null;
  warmUpQueries:    string[];
  searchCounters:   SearchCounter[];
  mappedActivities: MappedActivity[];
  seenScreenIds:    string[];
  header:           AppHeaderState;
  debug:            AppDebugState;
}

export const INITIAL_STATE: AppState = {
  isRunning:        false,
  isLingering:      false,
  currentIndex:     0,
  lastRunDate:      null,
  warmUpQueries:    [],
  searchCounters:   [],
  mappedActivities: [],
  seenScreenIds:    [],
  header: {
    status:            'idle',
    completedSearches: 0,
    totalSearches:     0,
    lastSearchString:  '',
  },
  debug: {
    debugLog:      [],
    domDebug:      null,
    dailySetDebug: null,
  },
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
  const stored = await chrome.storage.local.get();
  cache = { ...INITIAL_STATE, ...stored } as AppState;
  return cache;
}

/** Write updates to both the cache and storage. */
export async function setState(updates: Partial<AppState>): Promise<void> {
  if (!cache) cache = { ...INITIAL_STATE };
  Object.assign(cache, updates);
  await chrome.storage.local.set(updates);
}

async function setSubState<K extends 'header' | 'debug'>(key: K, updates: Partial<AppState[K]>): Promise<void> {
  if (!cache) cache = { ...INITIAL_STATE };
  cache[key] = { ...cache[key], ...updates } as AppState[K];
  await chrome.storage.local.set({ [key]: cache[key] });
}

/** Write header-specific updates, merging into the header subobject. */
export const setHeaderState = (u: Partial<AppHeaderState>) => setSubState('header', u);

/** Write debug-specific updates, merging into the debug subobject. */
export const setDebugState = (u: Partial<AppDebugState>) => setSubState('debug', u);

/** Reset all persistent state to initial values, with optional overrides applied atomically.
 *  seenScreenIds is preserved by default — pass { seenScreenIds: [] } to wipe it (e.g. purge). */
export async function resetState(overrides: Partial<AppState> = {}): Promise<void> {
  if (!cache) await loadState();
  const seenScreenIds = cache!.seenScreenIds;
  cache = { ...INITIAL_STATE, seenScreenIds, ...overrides };
  await chrome.storage.local.set(cache);
}
