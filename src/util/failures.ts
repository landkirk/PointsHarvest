import { MSG_ACTION } from './messaging.js';
import { setState } from './state.js';
import { dbg, DBG } from './debug.js';

export type FailureCategory = 'navigation' | 'search' | 'validation' | 'counter';

export interface Failure {
  time:          string;
  category:      FailureCategory;
  message:       string;
  orchestrator?: string;
}

const MAX_FAILURES = 50;

let failures: Failure[] = [];

export function resetFailures(): void { failures = []; }

/** Records a user-facing soft failure. Also writes a ERROR entry to the debug log. */
export async function fail(category: FailureCategory, message: string, orchestrator?: string): Promise<void> {
  await dbg(DBG.ERROR, message, orchestrator);
  const entry: Failure = { time: new Date().toLocaleTimeString('en-US', { hour12: false }), category, message, orchestrator };
  failures.push(entry);
  if (failures.length > MAX_FAILURES) failures.shift();
  await setState({ failures: [...failures] });
  chrome.runtime.sendMessage({ action: MSG_ACTION.FAILURE_ENTRY, failure: entry }).catch(() => {});
}
