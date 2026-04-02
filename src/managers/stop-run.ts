import {
  setState,
  loadState,
  setHeaderState,
  getActiveOrchestrator,
  setIsActivelyRunning,
} from '../util/state.js';
import { dbg, DBG } from '../util/debug.js';
import { createContext } from '../util/context.js';
import { removeTab } from '../util/tabs.js';

class StopRun {
  async run(): Promise<void> {
    setIsActivelyRunning(false);
    await setState({ isRunning: false, isLingering: false });
    const ctx = createContext();
    await getActiveOrchestrator()?.stop(ctx);
    const { rewardsTabId } = await loadState();
    if (rewardsTabId) removeTab(rewardsTabId);
    await setHeaderState({ headerMessage: 'Stopped', activePhase: null });
    await dbg(DBG.WARN, 'Run stopped by user');
    await ctx.broadcastProgress();
  }
}

export { StopRun };
