import type { DebugEntry } from './debug.js';
import { FAIL, isFailCategory } from './failures.js';
import type { FailureCategory, FailureEntry } from './failures.js';
import type { ActivityState } from './activity-types.js';
import { INITIAL_PHASE_STATES } from './phase.js';
import type { PhaseKey, PhaseStates } from './phase.js';
import type { UserActionConfig } from '../steps/wait-for-user-action.js';

// ── Persistent store ───────────────────────────────────────────────────────
// Backed by chrome.storage.local. Survives service worker restarts.

export interface SearchCounter {
  type: string;
  current: number;
  max: number;
  currentPoints: number;
  maxPoints: number;
}

export interface HeaderState {
  headerMessage: string;
  activePhase: PhaseKey | null;
  phaseStates: PhaseStates;
}

export interface DebugState {
  debugLog: DebugEntry[];
}

export const RUN_END = {
  SUCCESS: 'success',
  STOPPED: 'stopped',
  NOT_LOGGED_IN: 'not-logged-in',
  FATAL: 'fatal',
  SETUP_FAILED: 'setup-failed',
} as const;

export type RunEndReason = (typeof RUN_END)[keyof typeof RUN_END];

export interface RunSummary {
  startedAt: number;
  endedAt: number;
  endReason: RunEndReason;
  phaseStates: PhaseStates;
  activityCounts: {
    dailySetsCompleted: number;
    exploreCompleted: number;
    moreActivitiesCompleted: number;
    locked: number;
    actionableLeftover: number;
  };
  failureCount: number;
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
  activeUserAction: UserActionConfig | null;
  warmUpQueries: string[];
  searchCounters: SearchCounter[];
  rewardsTabId: number | null;
  activityState: ActivityState | null;
  failures: FailureEntry[];
  header: HeaderState;
  debug: DebugState;
  lastRunSummary: RunSummary | null;
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
  activeUserAction: null,
  warmUpQueries: [],
  searchCounters: [],
  rewardsTabId: null,
  activityState: null,
  failures: [],
  header: {
    headerMessage: 'idle',
    activePhase: null,
    phaseStates: INITIAL_PHASE_STATES,
  },
  debug: {
    debugLog: [],
  },
  lastRunSummary: null,
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

  const patch: Partial<RunState> = {};

  // Pre-phaseStates shape: the old header carried `phases` + `phasePoints` maps
  // and RunSummary mirrored them. Any in-flight run state from before the upgrade
  // wouldn't survive an SW restart cleanly anyway, so just reset instead of migrating.
  const header = state.header as unknown as Record<string, unknown> | null | undefined;
  if (header == null || 'phases' in header || !('phaseStates' in header)) {
    state.header = INITIAL_RUN_STATE.header;
    patch.header = state.header;
  }
  const lastSummary = state.lastRunSummary as unknown as Record<string, unknown> | null;
  if (lastSummary && (!('phaseStates' in lastSummary) || 'phases' in lastSummary)) {
    state.lastRunSummary = null;
    patch.lastRunSummary = null;
  }

  let dirty = false;
  const migrated = state.failures.map((f) => {
    const cat = migrateFailureCategory(f.category);
    if (cat === f.category) return f;
    dirty = true;
    return { ...f, category: cat };
  });
  if (dirty) {
    state.failures = migrated;
    patch.failures = migrated;
  }

  if (Object.keys(patch).length > 0) await setRunState(patch);

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
 *  value so callers can pass e.g. `{ phaseStates: { daily: {...} } }` without
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
  Omit<HeaderState, 'phaseStates'> & {
    phaseStates: Partial<Record<PhaseKey, Partial<HeaderState['phaseStates'][PhaseKey]>>>;
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

/** Single read-modify-write pass on `header`. The callback sees the current
 *  state and returns a patch; sibling values inside `phaseStates[key]` are
 *  preserved (two-level merge). Returns the merged result so callers can avoid
 *  a follow-up read. */
export async function updateHeaderState(
  fn: (current: HeaderState) => HeaderStateUpdate,
): Promise<HeaderState> {
  let result!: HeaderState;
  await enqueueWrite(async () => {
    const stored = await chrome.storage.local.get('header');
    const current: HeaderState = (stored.header as HeaderState) ?? INITIAL_RUN_STATE.header;
    const patch = fn(current);
    const merged: HeaderState = { ...current, ...(patch as Partial<HeaderState>) };
    if (patch.phaseStates) {
      merged.phaseStates = { ...current.phaseStates };
      for (const [k, v] of Object.entries(patch.phaseStates)) {
        if (!v) continue;
        const key = k as PhaseKey;
        merged.phaseStates[key] = { ...current.phaseStates[key], ...v };
      }
    }
    result = merged;
    await chrome.storage.local.set({ header: merged });
  });
  return result;
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
