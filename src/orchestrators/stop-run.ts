import { session, setState, resetSession } from '../util/state.js';
import { dbg } from '../util/debug.js';
import { createContext } from '../util/context.js';
import { getActiveOrchestrator } from './start-run.js';
import { closeRewardsTab } from '../util/tabs.js';


class StopRun {
  async run(): Promise<void> {
    session.isActivelyRunning = false;
    await setState({ isRunning: false, status: 'Stopped' });
    await dbg('warn', 'Run stopped by user');
    closeRewardsTab();
    if (session.resolveActivities) { session.resolveActivities({ activities: [], domDebug: null, loggedIn: false }); }
    await getActiveOrchestrator()?.stop(createContext());
    resetSession();
  }
}

export { StopRun };
