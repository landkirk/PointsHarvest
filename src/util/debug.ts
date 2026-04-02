import { MSG_ACTION } from './messaging.js';
import { setDebugState, getDebugLog } from './persistent-state.js';

export type DebugType = 'info' | 'warn' | 'error' | 'success';

export interface DebugEntry {
  time: string;
  type: DebugType;
  message: string;
  orchestrator?: string;
}

export const DBG = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  SUCCESS: 'success',
} as const satisfies Record<string, DebugType>;

const MAX_LOG_ENTRIES = 350;

/** Appends a typed log entry, persists to storage, and notifies the popup. */
export async function dbg(type: DebugType, message: string, orchestrator?: string): Promise<void> {
  const entry: DebugEntry = {
    time: new Date().toLocaleTimeString('en-US', { hour12: false }),
    type,
    message,
    orchestrator,
  };
  const log = [...(await getDebugLog()), entry];
  if (log.length > MAX_LOG_ENTRIES) log.shift();
  await setDebugState({ debugLog: log });
  chrome.runtime.sendMessage({ action: MSG_ACTION.DEBUG_ENTRY, entry }).catch(() => {
    /* popup may be closed */
  });
}
