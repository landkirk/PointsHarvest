import { setState, setHeaderState, getHeaderState, getActiveOrchestrator } from './state.js';
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
  broadcastProgress: () => Promise<void>;
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
      const { headerMessage, activePhase, phaseProgress, phasePoints } = payload;
      await setHeaderState({
        headerMessage,
        activePhase,
        ...(activePhase != null && { phases: { [activePhase]: phaseProgress } }),
        phasePoints,
      });
      await this.broadcastProgress();
    },
    async broadcastProgress(): Promise<void> {
      const merged = await getHeaderState();
      chrome.runtime
        .sendMessage({
          action: MSG_ACTION.PROGRESS,
          headerMessage: merged.headerMessage,
          activePhase: merged.activePhase,
          phases: merged.phases,
          phasePoints: merged.phasePoints,
        })
        .catch(() => {
          /* popup may be closed */
        });
    },
  };
}
