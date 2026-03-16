import { session, setState, resetSession } from '../util/state.js';
import { dbg } from '../util/debug.js';


class StopRun {
  async run(): Promise<void> {
    session.isActivelyRunning = false;
    await setState({ isRunning: false, status: 'Stopped' });
    await dbg('warn', 'Run stopped by user');
    if (session.pendingResolve)         { session.pendingResolve(); }
    if (session.resolveActivities)      { session.resolveActivities({ activities: [], domDebug: null, loggedIn: false }); }
    if (session.captureNextTabResolve)  { session.captureNextTabResolve({} as chrome.tabs.Tab); }
    if (session.lingerResolve)          { session.lingerResolve(); }
    for (const tabId of session.openedTabIds) {
      chrome.tabs.remove(tabId).catch(() => {});
    }
    resetSession();
  }
}

export { StopRun };
