import { MSG_ACTION } from './config.js';
import { setState } from './state.js';

export type DebugType = 'info' | 'warn' | 'error';

export interface DebugEntry {
  time: string;
  type: DebugType;
  message: string;
}

const MAX_LOG_ENTRIES = 100;

let log: DebugEntry[] = [];

/** Clears the in-memory log (call at the start of each run). */
export function resetLog(): void {
  log = [];
}

/** Appends a typed log entry, persists to storage, and notifies the popup. */
export async function dbg(type: DebugType, message: string): Promise<void> {
  const entry: DebugEntry = { time: new Date().toLocaleTimeString('en-US', { hour12: false }), type, message };
  log.push(entry);
  if (log.length > MAX_LOG_ENTRIES) log.shift();
  await setState({ debugLog: log });
  chrome.runtime.sendMessage({ action: MSG_ACTION.DEBUG_ENTRY, entry }).catch(() => {});
}
