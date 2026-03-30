import {
  setState,
  setHeaderState,
  getHeaderState,
  getActiveOrchestrator,
} from './state.js';
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
  updateHeader: (payload: ProgressPayload) => Promise<void>;
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
    async updateHeader(payload: ProgressPayload): Promise<void> {
      const headerUpdate: Parameters<typeof setHeaderState>[0] = {};
      if (payload.headerMessage !== undefined) headerUpdate.headerMessage = payload.headerMessage;
      if (payload.activePhase !== undefined) headerUpdate.activePhase = payload.activePhase;
      if (payload.activePhase != null && payload.phaseProgress !== undefined) {
        headerUpdate.phases = { [payload.activePhase]: payload.phaseProgress };
      }
      if (payload.phasePoints !== undefined) {
        headerUpdate.phasePoints = payload.phasePoints;
      }
      if (Object.keys(headerUpdate).length) await setHeaderState(headerUpdate);

      // Cache is now up-to-date — read merged state for broadcast.
      const { phases, phasePoints } = getHeaderState();
      chrome.runtime
        .sendMessage({ action: MSG_ACTION.PROGRESS, ...payload, phases, phasePoints })
        .catch(() => {
          /* popup may be closed */
        });
    },
  };
}
