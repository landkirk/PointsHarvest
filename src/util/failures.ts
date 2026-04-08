import { MSG_ACTION } from './messaging.js';
import { setRunState, getFailures } from './persistent-state.js';
import { dbg, DBG } from './debug.js';
import type { Context } from './context.js';
import type { OrchestratorBase } from '../interfaces/orchestrator.js';
import type { StepBase } from '../interfaces/step.js';
import type { Activity } from './activity.js';

export type FailureCategory = 'navigation' | 'search' | 'validation' | 'counter' | 'setup';

export interface FailureEntry {
  time: string;
  category: FailureCategory;
  message: string;
  orchestrator?: OrchestratorBase;
  step?: StepBase;
  activity?: Activity;
}

const MAX_FAILURES = 50;

/** Removes all failures with category 'setup' from persistent state. */
export async function clearSetupFailures(): Promise<void> {
  const failures = await getFailures();
  const filtered = failures.filter((f) => f.category !== 'setup');
  if (filtered.length !== failures.length) {
    await setRunState({ failures: filtered });
  }
}

/** Records a user-facing soft failure. Also writes a ERROR entry to the debug log. */
export async function fail(
  category: FailureCategory,
  message: string,
  ctx: Context,
): Promise<void> {
  await dbg(DBG.ERROR, message, ctx.activeOrchestrator?.name);
  const entry: FailureEntry = {
    time: new Date().toLocaleTimeString('en-US', { hour12: false }),
    category,
    message,
    orchestrator: ctx.activeOrchestrator ?? undefined,
    step: ctx.activeStep ?? undefined,
    activity: ctx.activeActivity ?? undefined,
  };
  const failures = [...(await getFailures()), entry];
  if (failures.length > MAX_FAILURES) failures.shift();
  await setRunState({ failures });
  chrome.runtime.sendMessage({ action: MSG_ACTION.FAILURE_ENTRY, failure: entry }).catch(() => {
    /* popup may be closed */
  });
}
