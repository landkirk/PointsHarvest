import type { DebugEntry } from './debug.js';
import type { Failure } from './failures.js';
import type { MappedActivity, ActivityState } from './activity.js';
import type { OrchestratorBase } from '../interfaces/orchestrator.js';

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

export interface AppHeaderState {
  headerMessage: string;
  activePhase: PhaseKey | null;
  phases: PhaseProgressMap;
  phasePoints: PhasePointsMap;
}

export interface AppDebugState {
  debugLog: DebugEntry[];
}

export interface AppState {
  isRunning: boolean;
  isLingering: boolean;
  lastRunDate: string | null;
  warmUpQueries: string[];
  searchCounters: SearchCounter[];
  rewardsTabId: number | null;
  activityState: ActivityState | null;
  mappedActivities: MappedActivity[];
  seenScreenIds: string[];
  ignoredUpdateVersion: string | null;
  skipWarmUp: boolean;
  failures: Failure[];
  header: AppHeaderState;
  debug: AppDebugState;
}

export const INITIAL_STATE: AppState = {
  isRunning: false,
  isLingering: false,
  lastRunDate: null,
  warmUpQueries: [],
  searchCounters: [],
  rewardsTabId: null,
  activityState: null,
  mappedActivities: [],
  seenScreenIds: [],
  ignoredUpdateVersion: null,
  skipWarmUp: false,
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
  writeQueue = writeQueue.then(fn);
  return writeQueue;
}

// ── In-memory runtime state (not persisted) ────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOrchestrator = OrchestratorBase<any[]>;

let isActivelyRunning = false;
let activeOrchestrator: AnyOrchestrator | null = null;

export function getIsActivelyRunning(): boolean {
  return isActivelyRunning;
}
export function setIsActivelyRunning(value: boolean): void {
  isActivelyRunning = value;
}

export function getActiveOrchestrator(): AnyOrchestrator | null {
  return activeOrchestrator;
}
export function setActiveOrchestrator(instance: AnyOrchestrator | null): void {
  activeOrchestrator = instance;
}

/** Load full state from storage. */
export async function loadState(): Promise<AppState> {
  const stored = await chrome.storage.local.get();
  return { ...INITIAL_STATE, ...stored } as AppState;
}

/** Write partial updates to storage. */
export function setState(updates: Partial<AppState>): Promise<void> {
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
  updates: Partial<AppState[K]>,
): Promise<void> {
  return enqueueWrite(async () => {
    const stored = await chrome.storage.local.get(key);
    const current: Record<string, unknown> = stored[key] ?? INITIAL_STATE[key];
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
  Omit<AppHeaderState, 'phases' | 'phasePoints'> & {
    phases: Partial<PhaseProgressMap>;
    phasePoints: Partial<PhasePointsMap>;
  }
>;

/** Write header-specific updates, merging into the header subobject. */
export const setHeaderState = (u: HeaderStateUpdate) =>
  setSubState('header', u as Partial<AppHeaderState>);

/** Read current header state from storage. */
export async function getHeaderState(): Promise<AppHeaderState> {
  const stored = await chrome.storage.local.get('header');
  return (stored.header as AppHeaderState) ?? INITIAL_STATE.header;
}

/** Write debug-specific updates, merging into the debug subobject. */
export const setDebugState = (u: Partial<AppDebugState>) => setSubState('debug', u);

/** Read current debug log from storage. */
export async function getDebugLog(): Promise<DebugEntry[]> {
  const stored = await chrome.storage.local.get('debug');
  return (stored.debug as AppDebugState)?.debugLog ?? [];
}

/** Read current failures from storage. */
export async function getFailures(): Promise<Failure[]> {
  const stored = await chrome.storage.local.get('failures');
  return (stored.failures as Failure[]) ?? [];
}

/** Reset all persistent state to initial values, with optional overrides applied atomically.
 *  seenScreenIds and ignoredUpdateVersion are preserved by default — pass explicit overrides to wipe them (e.g. purge). */
export async function resetState(overrides: Partial<AppState> = {}): Promise<void> {
  const current = await loadState();
  return enqueueWrite(() => {
    const newState = {
      ...INITIAL_STATE,
      seenScreenIds: current.seenScreenIds,
      ignoredUpdateVersion: current.ignoredUpdateVersion,
      skipWarmUp: current.skipWarmUp,
      ...overrides,
    };
    return chrome.storage.local.set(newState);
  });
}
