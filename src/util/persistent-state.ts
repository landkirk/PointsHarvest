import type { DebugEntry } from './debug.js';
import { FAIL, isFailCategory } from './failures.js';
import type { FailureCategory, FailureEntry } from './failures.js';
import type { ActivityState } from './activity.js';

// ── Persistent store ───────────────────────────────────────────────────────
// Backed by chrome.storage.local. Survives service worker restarts.

export const PC_SEARCH_TYPE = 'pc search';

export interface SearchCounter {
  type: string;
  current: number;
  max: number;
  currentPoints: number;
  maxPoints: number;
}

export const PHASE = {
  WARMUP: 'warmup',
  EXPLORE: 'explore',
  DAILY: 'daily',
  FARM: 'farm',
} as const;

export type PhaseKey = (typeof PHASE)[keyof typeof PHASE];

export const PHASE_TIME_LABEL: Record<PhaseKey, string> = {
  warmup: '',
  explore: 'this week',
  daily: 'today',
  farm: 'today',
};

export interface PhaseProgress {
  done: number;
  total: number;
}

export interface PhaseProgressMap {
  warmup: PhaseProgress | null;
  explore: PhaseProgress | null;
  daily: PhaseProgress | null;
  farm: PhaseProgress | null;
}

export type PhasePointsMap = Record<PhaseKey, number>;

export interface HeaderState {
  headerMessage: string;
  activePhase: PhaseKey | null;
  phases: PhaseProgressMap;
  phasePoints: PhasePointsMap;
}

export interface DebugState {
  debugLog: DebugEntry[];
}

export interface UserPreferences {
  skipWarmUp: boolean;
  disableNotifications: boolean;
  debugMode: boolean;
  ignoredUpdateVersion: string | null;
  seenScreenIds: string[];
  timingMultiplier: number;
}

export interface RunState {
  isRunning: boolean;
  isLingering: boolean;
  warmUpQueries: string[];
  searchCounters: SearchCounter[];
  rewardsTabId: number | null;
  activityState: ActivityState | null;
  failures: FailureEntry[];
  header: HeaderState;
  debug: DebugState;
}

export const INITIAL_PREFERENCES: UserPreferences = {
  skipWarmUp: false,
  disableNotifications: false,
  debugMode: false,
  ignoredUpdateVersion: null,
  seenScreenIds: [],
  timingMultiplier: 1.0,
};

export const INITIAL_RUN_STATE: RunState = {
  isRunning: false,
  isLingering: false,
  warmUpQueries: [],
  searchCounters: [],
  rewardsTabId: null,
  activityState: null,
  failures: [],
  header: {
    headerMessage: 'idle',
    activePhase: null,
    phases: { warmup: null, explore: null, daily: null, farm: null },
    phasePoints: { warmup: 0, explore: 0, daily: 0, farm: 0 },
  },
  debug: {
    debugLog: [],
  },
};

let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(fn: () => Promise<void>): Promise<void> {
  writeQueue = writeQueue.then(fn).catch((err) => {
    console.warn('[persistent-state] write failed:', err);
  });
  return writeQueue;
}

/** Atomically appends one entry to the `failures` list, capping at max. */
export function appendFailureEntry(entry: FailureEntry, max: number): Promise<void> {
  return enqueueWrite(async () => {
    const stored = await chrome.storage.local.get('failures');
    const arr: FailureEntry[] = (stored.failures as FailureEntry[]) ?? [];
    const next = [...arr, entry];
    if (next.length > max) next.shift();
    await chrome.storage.local.set({ failures: next });
  });
}

/** Atomically appends one entry to the debug log, capping at max. */
export function appendDebugEntry(entry: DebugEntry, max: number): Promise<void> {
  return enqueueWrite(async () => {
    const stored = await chrome.storage.local.get('debug');
    const current: DebugState = (stored.debug as DebugState) ?? INITIAL_RUN_STATE.debug;
    const log = [...current.debugLog, entry];
    if (log.length > max) log.shift();
    await chrome.storage.local.set({ debug: { ...current, debugLog: log } });
  });
}

// ── Failure category migration ─────────────────────────────────────────────
// Maps legacy category strings (pre-FAIL constants) to current equivalents.
const LEGACY_CATEGORY_MAP: Record<string, FailureCategory> = {
  navigation: FAIL.TAB,
  counter: FAIL.SEARCH,
  setup: FAIL.FATAL,
};

function migrateFailureCategory(category: string): FailureCategory {
  if (isFailCategory(category)) return category;
  return LEGACY_CATEGORY_MAP[category] ?? FAIL.FATAL;
}

/** Load run state from storage. */
export async function loadRunState(): Promise<RunState> {
  const keys = Object.keys(INITIAL_RUN_STATE) as (keyof RunState)[];
  const stored = await chrome.storage.local.get(keys);
  const state = { ...INITIAL_RUN_STATE, ...stored } as RunState;

  let dirty = false;
  const migrated = state.failures.map((f) => {
    const cat = migrateFailureCategory(f.category);
    if (cat === f.category) return f;
    dirty = true;
    return { ...f, category: cat };
  });
  if (dirty) {
    state.failures = migrated;
    await setRunState({ failures: migrated });
  }

  return state;
}

/** Load user preferences from storage. */
export async function loadPreferences(): Promise<UserPreferences> {
  const keys = Object.keys(INITIAL_PREFERENCES) as (keyof UserPreferences)[];
  const stored = await chrome.storage.local.get(keys);
  return { ...INITIAL_PREFERENCES, ...stored } as UserPreferences;
}

/** Write partial run-state updates to storage. */
export function setRunState(updates: Partial<RunState>): Promise<void> {
  return enqueueWrite(() => chrome.storage.local.set(updates));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Deep-merge one level: plain object values are spread into the existing
 *  value so callers can pass e.g. `{ phasePoints: { daily: 5 } }` without
 *  clobbering sibling keys. Arrays and primitives replace outright. */
function setSubState<K extends 'header' | 'debug'>(
  key: K,
  updates: Partial<RunState[K]>,
): Promise<void> {
  return enqueueWrite(async () => {
    const stored = await chrome.storage.local.get(key);
    const current: Record<string, unknown> = stored[key] ?? INITIAL_RUN_STATE[key];
    const merged: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(updates)) {
      const cur = merged[k];
      if (isPlainObject(v) && isPlainObject(cur)) {
        merged[k] = { ...cur, ...v };
      } else {
        merged[k] = v;
      }
    }
    await chrome.storage.local.set({ [key]: merged });
  });
}

export type HeaderStateUpdate = Partial<
  Omit<HeaderState, 'phases' | 'phasePoints'> & {
    phases: Partial<PhaseProgressMap>;
    phasePoints: Partial<PhasePointsMap>;
  }
>;

/** Write header-specific updates, merging into the header subobject. */
export const setHeaderState = (u: HeaderStateUpdate) =>
  setSubState('header', u as Partial<HeaderState>);

/** Read current header state from storage. */
export async function getHeaderState(): Promise<HeaderState> {
  const stored = await chrome.storage.local.get('header');
  return (stored.header as HeaderState) ?? INITIAL_RUN_STATE.header;
}

/** Write debug-specific updates, merging into the debug subobject. */
export const setDebugState = (u: Partial<DebugState>) => setSubState('debug', u);

/** Read current debug log from storage. */
export async function getDebugLog(): Promise<DebugEntry[]> {
  const stored = await chrome.storage.local.get('debug');
  return (stored.debug as DebugState)?.debugLog ?? [];
}

/** Read current failures from storage. */
export async function getFailures(): Promise<FailureEntry[]> {
  const stored = await chrome.storage.local.get('failures');
  return (stored.failures as FailureEntry[]) ?? [];
}

/** Reset run state to initial values. Preference keys are unaffected (storage.local.set is additive). */
export function resetRunState(overrides: Partial<RunState> = {}): Promise<void> {
  return enqueueWrite(() => chrome.storage.local.set({ ...INITIAL_RUN_STATE, ...overrides }));
}

/** Write preference updates to storage. */
export function setPreference(updates: Partial<UserPreferences>): Promise<void> {
  return enqueueWrite(() => chrome.storage.local.set(updates));
}
