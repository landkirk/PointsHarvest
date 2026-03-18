import { MSG_ACTION } from '../util/messaging.js';
import { resetLog, DBG } from '../util/debug.js';
import { loadState, resetState, getIsActivelyRunning, setIsActivelyRunning, setActiveOrchestrator } from '../util/state.js';
import { createContext } from '../util/context.js';
import { NotLoggedInError } from '../steps/fetch-activities.js';
import type { Context } from '../util/context.js';
import { StoppedError } from '../interfaces/orchestrator.js';
import type { OrchestratorBase } from '../interfaces/orchestrator.js';

import { CompleteExploreOnBing } from './complete-explore-on-bing.js';
import { CompleteDailySets } from './complete-daily-sets.js';
import { FarmPcSearches } from './farm-pc-searches.js';
import { WarmUpSearches } from './warm-up-searches.js';

interface RunOptions {
  today:        string;
  lastRunDate:  string | null;
  currentIndex: number;
  alreadyDone:  boolean;
}


class StartRun {
  async run(): Promise<void> {
    const today = new Date().toDateString();
    const { lastRunDate, currentIndex, completedSearches } = await loadState();
    const alreadyDone = lastRunDate === today && completedSearches > 0 && currentIndex >= completedSearches;

    resetLog();
    await resetState({ isRunning: true, status: 'Starting...', lastRunDate: today });

    setIsActivelyRunning(true);
    const ctx = createContext();

    this._executeRun(ctx, { today, lastRunDate, currentIndex, alreadyDone }) // fire and forget
      .catch(err => ctx.dbg(DBG.ERROR, `Fatal run error: ${(err as Error).message}`));
  }

  private async _executeRun(ctx: Context, { today, lastRunDate, currentIndex, alreadyDone }: RunOptions): Promise<void> {
    await ctx.dbg(DBG.INFO, 'Run started');

    if (!getIsActivelyRunning()) return;

    const startIndex = (lastRunDate === today && currentIndex > 0 && !alreadyDone) ? currentIndex : 0;

    if (!getIsActivelyRunning()) return;

    try {
      // ── Chain orchestrators ──────────────────────────────────────────────────
      const warmUp         = new WarmUpSearches();
      const exploreOnBing  = new CompleteExploreOnBing();
      const dailySets      = new CompleteDailySets();
      const farmPcSearches = new FarmPcSearches();
      await this._runOrchestrator(ctx, warmUp,         () => warmUp.run(ctx));
      await this._runOrchestrator(ctx, exploreOnBing,  () => exploreOnBing.run(ctx, startIndex));
      await this._runOrchestrator(ctx, dailySets,      () => dailySets.run(ctx));
      await this._runOrchestrator(ctx, farmPcSearches, () => farmPcSearches.run(ctx));
    } catch (err) {
      if (err instanceof NotLoggedInError) {
        await this._endRun(ctx, 'Not logged in — sign into Bing first', 'Aborting: not logged into Bing Rewards', false);
        return;
      }
      throw err;
    }

    await this._endRun(ctx, 'Done for today!', 'All tasks complete', true);
  }

  private async _runOrchestrator(ctx: Context, orchestrator: OrchestratorBase<any[]>, run: () => Promise<void>): Promise<void> {
    if (!getIsActivelyRunning()) return;
    setActiveOrchestrator(orchestrator);
    try {
      await run();
    } catch (err) {
      if (err instanceof NotLoggedInError) throw err;
      if (err instanceof StoppedError) return;
      await ctx.dbg(DBG.ERROR, `${orchestrator.name} failed: ${(err as Error).message}`);
    } finally {
      setActiveOrchestrator(null);
    }
  }

  private async _endRun(ctx: Context, status: string, msg: string, success: boolean): Promise<void> {
    setIsActivelyRunning(false);
    await ctx.setState({ isRunning: false, status });
    await ctx.dbg(success ? DBG.SUCCESS : DBG.ERROR, msg);
    chrome.runtime.sendMessage({ action: MSG_ACTION.COMPLETE }).catch(() => {});
  }
}

export { StartRun };
