import { MSG_ACTION } from './messaging.js';
import { setDebugState } from './state.js';
import type { CardState } from './activity.js';

export type { DebugType, DebugEntry } from './messaging.js';
import type { DebugEntry, DebugType } from './messaging.js';

export const DBG = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  SUCCESS: 'success',
} as const satisfies Record<string, DebugType>;

export interface ActivityScanEntry {
  skipReason: CardState | null;
  snippet: string;
}

export interface ActivityScan {
  actionableActivities: number;
  skippedLocked: number;
  skippedCompleted: number;
  activities: ActivityScanEntry[];
}

const MAX_LOG_ENTRIES = 100;

let log: DebugEntry[] = [];

/** Clears the in-memory log (call at the start of each run). */
export function resetLog(): void {
  log = [];
}

/** Appends a typed log entry, persists to storage, and notifies the popup. */
export async function dbg(type: DebugType, message: string, orchestrator?: string): Promise<void> {
  const entry: DebugEntry = {
    time: new Date().toLocaleTimeString('en-US', { hour12: false }),
    type,
    message,
    orchestrator,
  };
  log.push(entry);
  if (log.length > MAX_LOG_ENTRIES) log.shift();
  await setDebugState({ debugLog: log });
  chrome.runtime.sendMessage({ action: MSG_ACTION.DEBUG_ENTRY, entry }).catch(() => {});
}
