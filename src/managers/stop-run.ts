import { setRunState, loadRunState, setHeaderState } from '../util/persistent-state.js';
import { dbg, DBG } from '../util/debug.js';
import { createContext } from '../util/context.js';
import { TabManager } from '../util/tab-manager.js';
import { getActiveController, getActiveContext } from './start-run.js';
import { StoppedError } from '../interfaces/stoppable.js';

class StopRun {
  constructor(private readonly tabs: TabManager) {}

  async run(): Promise<void> {
    const controller = getActiveController();
    if (!controller || controller.signal.aborted) return;
    controller.abort(new StoppedError());
    await setRunState({ isLingering: false });
    const ctx = createContext(AbortSignal.abort(new StoppedError()));
    await getActiveContext()?.activeOrchestrator?.stop(ctx);
    await this.tabs.closeAll();
    const { rewardsTabId } = await loadRunState();
    if (rewardsTabId) this.tabs.closeTab(rewardsTabId);
    await setHeaderState({ headerMessage: 'Stopping…', activePhase: null });
    await dbg(DBG.WARN, 'Run stopped by user');
    await ctx.broadcastProgress();
  }
}

export { StopRun };
