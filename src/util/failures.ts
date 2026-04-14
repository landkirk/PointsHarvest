import { MSG_ACTION } from './messaging.js';
import { appendFailureEntry, getFailures, setRunState } from './persistent-state.js';
import { dbg, DBG } from './debug.js';
import type { Context } from './context.js';

export const FAIL = {
  AUTH: 'auth',
  PERMISSION: 'permission',
  TAB: 'tab',
  SEARCH: 'search',
  VALIDATION: 'validation',
  FATAL: 'fatal',
} as const;

export type FailureCategory = (typeof FAIL)[keyof typeof FAIL];

const FAIL_VALUES: ReadonlySet<string> = new Set(Object.values(FAIL));
export function isFailCategory(s: string): s is FailureCategory {
  return FAIL_VALUES.has(s);
}

export interface FailureEntry {
  time: string;
  category: FailureCategory;
  message: string;
  orchestratorName?: string;
  stepName?: string;
  activityTitle?: string;
}

const MAX_FAILURES = 50;

/** Removes all failures with category 'permission' from persistent state. */
export async function clearPermissionFailures(): Promise<void> {
  const failures = await getFailures();
  const filtered = failures.filter((f) => f.category !== FAIL.PERMISSION);
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
    orchestratorName: ctx.activeOrchestrator?.name,
    stepName: ctx.activeStep?.name,
    activityTitle: ctx.activeActivity?.title,
  };
  await appendFailureEntry(entry, MAX_FAILURES);
  chrome.runtime.sendMessage({ action: MSG_ACTION.FAILURE_ENTRY, failure: entry }).catch(() => {
    /* popup may be closed */
  });
}
