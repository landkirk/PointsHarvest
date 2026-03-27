import { setState, setHeaderState, getActiveOrchestrator } from './state.js';
import { dbg } from './debug.js';
import { fail } from './failures.js';
import { MSG_ACTION } from './messaging.js';
import type { AppState } from './state.js';
import type { DebugType, FailureCategory } from './messaging.js';
import type { ProgressPayload } from './messaging.js';

export interface Context {
  setState: (updates: Partial<AppState>) => Promise<void>;
  dbg: (type: DebugType, message: string) => Promise<void>;
  fail: (category: FailureCategory, message: string) => Promise<void>;
  setHeaderMessage: (payload: ProgressPayload) => void;
}

export function createContext(): Context {
  return {
    setState,
    dbg(type: DebugType, message: string): Promise<void> {
      return dbg(type, message, getActiveOrchestrator()?.name);
    },
    fail(category: FailureCategory, message: string): Promise<void> {
      return fail(category, message, getActiveOrchestrator()?.name);
    },
    setHeaderMessage(payload: ProgressPayload): void {
      const headerUpdate: Parameters<typeof setHeaderState>[0] = {};
      if (payload.status !== undefined) headerUpdate.status = payload.status;
      if (payload.completedSearches !== undefined)
        headerUpdate.completedSearches = payload.completedSearches;
      if (payload.totalSearches !== undefined) headerUpdate.totalSearches = payload.totalSearches;
      if (payload.lastSearchString !== undefined)
        headerUpdate.lastSearchString = payload.lastSearchString;
      if (Object.keys(headerUpdate).length)
        setHeaderState(headerUpdate).catch(() => {
          /* non-critical: UI display state */
        });
      chrome.runtime.sendMessage({ action: MSG_ACTION.PROGRESS, ...payload }).catch(() => {
        /* popup may be closed */
      });
    },
  };
}
