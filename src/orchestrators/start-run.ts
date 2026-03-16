import { MSG_ACTION } from '../util/messaging.js';
import { randMs, sleep, TIMING } from '../util/timing.js';
import { resetLog } from '../util/debug.js';
import { loadState, resetState } from '../util/state.js';
import { createContext } from '../util/context.js';
import { NotLoggedInError } from '../steps/fetch-activities.js';
import type { Context } from '../util/context.js';

import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { CompleteExploreOnBing } from './complete-explore-on-bing.js';
import { CompleteDailySets } from './complete-daily-sets.js';
import { FarmPcSearches } from './farm-pc-searches.js';

type ActiveOrchestrator = Pick<OrchestratorBase, 'stop' | 'onTabUpdated' | 'onTabCreated' | 'onTabRemoved' | 'onUserActionComplete'>;

let activeOrchestrator: ActiveOrchestrator | null = null;
let isActivelyRunning   = false;

export function getActiveOrchestrator(): ActiveOrchestrator | null {
  return activeOrchestrator;
}

export function getIsActivelyRunning(): boolean {
  return isActivelyRunning;
}

export function setIsActivelyRunning(value: boolean): void {
  isActivelyRunning = value;
}

interface RunOptions {
  today:        string;
  lastRunDate:  string | null;
  currentIndex: number;
  alreadyDone:  boolean;
}


class StartRun {
  private readonly completeExploreOnBing = new CompleteExploreOnBing();
  private readonly completeDailySets     = new CompleteDailySets();
  private readonly farmPcSearches        = new FarmPcSearches();

  async run(): Promise<void> {
    const today = new Date().toDateString();
    const { lastRunDate, currentIndex, completedSearches } = await loadState();
    const alreadyDone = lastRunDate === today && completedSearches > 0 && currentIndex >= completedSearches;

    resetLog();
    await resetState({ isRunning: true, status: 'Starting...', lastRunDate: today });

    setIsActivelyRunning(true);
    const ctx = createContext();

    this._executeRun(ctx, { today, lastRunDate, currentIndex, alreadyDone }) // fire and forget
      .catch(err => ctx.dbg('error', `Fatal run error: ${(err as Error).message}`));
  }

  private async _executeRun(ctx: Context, { today, lastRunDate, currentIndex, alreadyDone }: RunOptions): Promise<void> {
    await ctx.dbg('info', 'Run started');

    if (!isActivelyRunning) return;

    const startIndex = (lastRunDate === today && currentIndex > 0 && !alreadyDone) ? currentIndex : 0;

    const initialDelay = randMs(...TIMING.INITIAL_DELAY);
    await ctx.dbg('info', `Initial delay: ${(initialDelay / 1000).toFixed(1)}s`);
    await sleep(initialDelay);

    if (!isActivelyRunning) return;

    try {
      // ── Chain orchestrators ──────────────────────────────────────────────────
      await this._runOrchestrator(ctx, 'Explore on Bing',   this.completeExploreOnBing, () => this.completeExploreOnBing.run(ctx, startIndex));
      await this._runOrchestrator(ctx, 'Daily sets',        this.completeDailySets,     () => this.completeDailySets.run(ctx));
      await this._runOrchestrator(ctx, 'PC search farming', this.farmPcSearches,        () => this.farmPcSearches.run(ctx));
    } catch (err) {
      if (err instanceof NotLoggedInError) {
        await this._abortRun(ctx, 'Not logged in — sign into Bing first', 'Aborting: not logged into Bing Rewards');
        return;
      }
      throw err;
    }

    await this._completeRun(ctx);
  }

  private async _runOrchestrator(ctx: Context, label: string, orchestrator: ActiveOrchestrator, run: () => Promise<void>): Promise<void> {
    activeOrchestrator = orchestrator;
    try {
      await run();
    } catch (err) {
      if (err instanceof NotLoggedInError) throw err;
      await ctx.dbg('error', `${label} failed: ${(err as Error).message}`);
    } finally {
      activeOrchestrator = null;
    }
  }

  private async _completeRun(ctx: Context): Promise<void> {
    setIsActivelyRunning(false);
    await ctx.setState({ isRunning: false, status: 'Done for today!' });
    await ctx.dbg('success', 'All tasks complete');
    chrome.runtime.sendMessage({ action: MSG_ACTION.COMPLETE }).catch(() => {});
  }

  private async _abortRun(ctx: Context, status: string, errorMsg: string): Promise<void> {
    setIsActivelyRunning(false);
    await ctx.setState({ isRunning: false, status });
    await ctx.dbg('error', errorMsg);
    chrome.runtime.sendMessage({ action: MSG_ACTION.COMPLETE }).catch(() => {});
  }
}

export { StartRun };
