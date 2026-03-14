import { session, setState, resetSession } from '../util/state.js';
import { dbg } from '../util/debug.js';

export async function run() {
  session.isActivelyRunning = false;
  await setState({ isRunning: false, status: 'Stopped' });
  await dbg('warn', 'Run stopped by user');
  if (session.pendingResolve) { session.pendingResolve(); }
  if (session.resolveActivities) { session.resolveActivities({}); }
  if (session.captureNextTabResolve) { session.captureNextTabResolve(null); }
  if (session.lingerResolve) { session.lingerResolve(); }
  for (const tabId of session.openedTabIds) {
    chrome.tabs.remove(tabId).catch(() => {});
  }
  resetSession();
}
