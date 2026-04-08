import { setRunState, setHeaderState, getHeaderState } from './persistent-state.js';
import { dbg } from './debug.js';
import { fail } from './failures.js';
import { MSG_ACTION } from './messaging.js';
import type { OrchestratorBase } from '../interfaces/orchestrator.js';
import type { StepBase } from '../interfaces/step.js';
import type { Activity } from './activity.js';
import type { RunState } from './persistent-state.js';
import type { DebugType } from './debug.js';
import type { FailureCategory } from './failures.js';
import type { ProgressPayload } from './messaging.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOrchestrator = OrchestratorBase<any[]>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStep = StepBase<any[], any>;

export interface Context {
  signal: AbortSignal;
  activeOrchestrator: AnyOrchestrator | null;
  activeStep: AnyStep | null;
  activeActivity: Activity | null;
  setState: (updates: Partial<RunState>) => Promise<void>;
  dbg: (type: DebugType, message: string) => Promise<void>;
  fail: (category: FailureCategory, message: string) => Promise<void>;
  updateHeader: (payload: ProgressPayload) => Promise<void>;
  broadcastProgress: () => Promise<void>;
}

export function createContext(signal: AbortSignal): Context {
  const ctx: Context = {
    signal,
    activeOrchestrator: null,
    activeStep: null,
    activeActivity: null,
    setState: setRunState,
    dbg(type: DebugType, message: string): Promise<void> {
      return dbg(type, message, ctx.activeOrchestrator?.name);
    },
    fail(category: FailureCategory, message: string): Promise<void> {
      return fail(category, message, ctx.activeOrchestrator?.name);
    },
    async updateHeader(payload: ProgressPayload): Promise<void> {
      const { headerMessage, activePhase, phaseProgress, phasePoints } = payload;
      await setHeaderState({
        headerMessage,
        activePhase,
        ...(activePhase != null && { phases: { [activePhase]: phaseProgress } }),
        phasePoints,
      });
      await ctx.broadcastProgress();
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
  return ctx;
}
