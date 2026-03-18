import { setState, getActiveOrchestrator } from './state.js';
import { dbg } from './debug.js';
import { MSG_ACTION } from './messaging.js';
import type { AppState } from './state.js';
import type { DebugType } from './debug.js';
import type { ProgressPayload } from './messaging.js';

export interface Context {
  setState: (updates: Partial<AppState>) => Promise<void>;
  dbg: (type: DebugType, message: string) => Promise<void>;
  setHeaderMessage: (payload: ProgressPayload) => void;
}

export function createContext(): Context {
  return {
    setState,
    dbg(type: DebugType, message: string): Promise<void> {
      return dbg(type, message, getActiveOrchestrator()?.name);
    },
    setHeaderMessage(payload: ProgressPayload): void {
      const stateUpdate: Partial<AppState> = {};
      if (payload.status    !== undefined) stateUpdate.status            = payload.status;
      if (payload.completedSearches !== undefined) stateUpdate.completedSearches = payload.completedSearches;
      if (payload.totalSearches     !== undefined) stateUpdate.totalSearches     = payload.totalSearches;
      if (payload.lastSearchString !== undefined) stateUpdate.lastSearchString = payload.lastSearchString;
      if (Object.keys(stateUpdate).length) setState(stateUpdate).catch(() => {});
      chrome.runtime.sendMessage({ action: MSG_ACTION.PROGRESS, ...payload }).catch(() => {});
    },
  };
}
