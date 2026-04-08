import { setRunState, loadRunState, setHeaderState } from '../util/persistent-state.js';
import { getActiveOrchestrator } from '../util/runtime-state.js';
import { dbg, DBG } from '../util/debug.js';
import { createContext } from '../util/context.js';
import { TabManager } from '../util/tab-manager.js';
import { getActiveController } from './start-run.js';
import { StoppedError } from '../interfaces/stoppable.js';

class StopRun {
  constructor(private readonly tabs: TabManager) {}

  async run(): Promise<void> {
    getActiveController()?.abort(new StoppedError());
    await setRunState({ isRunning: false, isLingering: false });
    const ctx = createContext(AbortSignal.abort(new StoppedError()));
    await getActiveOrchestrator()?.stop(ctx);
    await this.tabs.closeAll();
    const { rewardsTabId } = await loadRunState();
    if (rewardsTabId) this.tabs.closeTab(rewardsTabId);
    await setHeaderState({ headerMessage: 'Stopped', activePhase: null });
    await dbg(DBG.WARN, 'Run stopped by user');
    await ctx.broadcastProgress();
  }
}

export { StopRun };
