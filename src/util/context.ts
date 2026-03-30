import {
  setState,
  setHeaderState as persistHeaderState,
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
  updateHeader: (payload: ProgressPayload) => void;
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
    updateHeader(payload: ProgressPayload): void {
      const headerUpdate: Parameters<typeof persistHeaderState>[0] = {};
      if (payload.headerMessage !== undefined) headerUpdate.headerMessage = payload.headerMessage;
      if (payload.activePhase !== undefined) headerUpdate.activePhase = payload.activePhase;
      const current = getHeaderState();
      if (payload.activePhase != null && payload.phaseProgress !== undefined) {
        headerUpdate.phases = { ...current.phases, [payload.activePhase]: payload.phaseProgress };
      }
      if (payload.phasePoints !== undefined) {
        headerUpdate.phasePoints = { ...current.phasePoints, ...payload.phasePoints };
      }
      if (Object.keys(headerUpdate).length)
        persistHeaderState(headerUpdate).catch(() => {
          /* non-critical: UI display state */
        });
      const phases = headerUpdate.phases ?? current.phases;
      const phasePoints = headerUpdate.phasePoints ?? current.phasePoints;
      chrome.runtime
        .sendMessage({ action: MSG_ACTION.PROGRESS, ...payload, phases, phasePoints })
        .catch(() => {
          /* popup may be closed */
        });
    },
  };
}
