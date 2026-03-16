import { setState } from './state.js';
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
    dbg,
    setHeaderMessage(payload: ProgressPayload): void {
      chrome.runtime.sendMessage({ action: MSG_ACTION.PROGRESS, ...payload }).catch(() => {});
    },
  };
}
