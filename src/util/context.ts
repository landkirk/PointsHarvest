import { setRunState, getHeaderState, updateHeaderState } from './persistent-state.js';
import { dbg } from './debug.js';
import { fail } from './failures.js';
import { MSG_ACTION } from './messaging.js';
import type { OrchestratorBase } from '../interfaces/orchestrator.js';
import type { StepBase } from '../interfaces/step.js';
import type { Activity } from './activity-types.js';
import type { HeaderState, RunState } from './persistent-state.js';
import type { DebugType } from './debug.js';
import type { FailureCategory } from './failures.js';
import type { PhaseUpdate } from './messaging.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOrchestrator = OrchestratorBase<any[]>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStep = StepBase<any[], any>;

function broadcast(header: HeaderState): void {
  chrome.runtime
    .sendMessage({
      action: MSG_ACTION.PROGRESS,
      headerMessage: header.headerMessage,
      activePhase: header.activePhase,
      phaseStates: header.phaseStates,
    })
    .catch(() => {
      /* popup may be closed */
    });
}

export interface Context {
  signal: AbortSignal;
  activeOrchestrator: AnyOrchestrator | null;
  activeStep: AnyStep | null;
  activeActivity: Activity | null;
  setState: (updates: Partial<RunState>) => Promise<void>;
  dbg: (type: DebugType, message: string) => Promise<void>;
  fail: (category: FailureCategory, message: string) => Promise<void>;
  setPhase: (update: PhaseUpdate) => Promise<void>;
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
      return fail(category, message, ctx);
    },
    async setPhase(update: PhaseUpdate): Promise<void> {
      const { phase, headerMessage, progress, points } = update;
      const merged = await updateHeaderState(() => {
        const phaseStates =
          progress !== undefined || points !== undefined
            ? {
                [phase.key]: {
                  ...(progress !== undefined && { progress }),
                  ...(points !== undefined && { points }),
                },
              }
            : undefined;
        return { headerMessage, activePhase: phase.key, ...(phaseStates && { phaseStates }) };
      });
      broadcast(merged);
    },
    async broadcastProgress(): Promise<void> {
      broadcast(await getHeaderState());
    },
  };
  return ctx;
}
