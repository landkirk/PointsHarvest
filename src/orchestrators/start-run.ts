import { REWARDS_URL } from '../util/config.js';
import { MSG_ACTION } from '../util/messaging.js';
import { randMs, sleep, TIMING } from '../util/timing.js';
import { resetLog } from '../util/debug.js';
import { resetSession, loadState, resetState } from '../util/state.js';
import { closeRewardsTab } from '../util/tabs.js';
import { createContext } from '../util/context.js';
import { run as fetchActivities, buildSearchList } from '../steps/fetch-activities.js';
import type { Context } from '../util/context.js';
import type { ActivitiesResult } from '../util/state.js';
import type { MappedActivity } from '../util/activity.js';

import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { CompleteExploreOnBing } from './complete-explore-on-bing.js';
import { CompleteDailySets } from './complete-daily-sets.js';
import { FarmPcSearches } from './farm-pc-searches.js';

type ActiveOrchestrator = Pick<OrchestratorBase, 'stop' | 'onTabUpdated' | 'onTabCreated' | 'onTabRemoved' | 'onUserActionComplete'>;

let activeOrchestrator: ActiveOrchestrator | null = null;

export function getActiveOrchestrator(): ActiveOrchestrator | null {
  return activeOrchestrator;
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

    resetSession();
    resetLog();
    await resetState({ isRunning: true, status: 'Fetching rewards activities...', lastRunDate: today });

    const ctx = createContext();
    ctx.session.isActivelyRunning = true;

    this._executeRun(ctx, { today, lastRunDate, currentIndex, alreadyDone }) // fire and forget
      .catch(err => ctx.dbg('error', `Fatal run error: ${(err as Error).message}`));
  }

  private async _executeRun(ctx: Context, { today, lastRunDate, currentIndex, alreadyDone }: RunOptions): Promise<void> {
    await ctx.dbg('info', 'Run started');

    await ctx.dbg('info', `Opening ${REWARDS_URL}`);
    const activitiesPromise = fetchActivities(ctx);
    const activitiesResult: ActivitiesResult = await activitiesPromise;
    const { activities, domDebug, loggedIn } = activitiesResult;

    if (!ctx.session.isActivelyRunning) { closeRewardsTab(); await ctx.dbg('warn', 'Stopped during activity fetch'); return; }

    if (!loggedIn) {
      await this._abortRun(ctx, 'Not logged in — sign into Bing first', 'Aborting: not logged into Bing Rewards');
      return;
    }

    await ctx.setState({ extractedActivities: activities, domDebug });
    await ctx.dbg('info', `DOM scan: ${domDebug?.actionElementsFound ?? '?'} actionable, ${domDebug?.skippedLocked ?? 0} locked, ${domDebug?.skippedCompleted ?? 0} completed, ${domDebug?.skippedUnknown ?? 0} unknown (skipped)`);

    if (activities.length === 0 && (activitiesResult.dailySets?.length ?? 0) === 0) {
      let pcFarmed = false;
      await this._runOrchestrator(ctx, 'PC search farming', this.farmPcSearches, async () => {
        await this.farmPcSearches.run(ctx);
        pcFarmed = true;
      });
      if (pcFarmed) {
        await this._completeRun(ctx);
      } else {
        await this._abortRun(ctx, 'No valid activity cards found — check Debug panel', 'Aborting: no valid activity cards detected on the rewards page');
      }
      return;
    }

    await ctx.dbg('success', `Found ${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}`);

    const mapped: MappedActivity[] = buildSearchList(activities);
    await ctx.setState({ mappedActivities: mapped, searchQueue: mapped.filter(m => m.query).map(m => m.query as string) });
    chrome.runtime.sendMessage({ action: MSG_ACTION.DEBUG_READY }).catch(() => {});

    const unmapped = mapped.filter(m => m.unmatched).length;
    await ctx.dbg('info', `Mapped ${mapped.length - unmapped}/${mapped.length} activit${mapped.length === 1 ? 'y' : 'ies'} (${unmapped} unmatched)`);

    const startIndex = (lastRunDate === today && currentIndex > 0 && !alreadyDone) ? currentIndex : 0;
    await ctx.setState({
      totalSearches:     mapped.length,
      currentIndex:      startIndex,
      completedSearches: startIndex,
      status:            `Running (0 / ${mapped.length})`,
    });

    const initialDelay = randMs(...TIMING.INITIAL_DELAY);
    await ctx.dbg('info', `Initial delay: ${(initialDelay / 1000).toFixed(1)}s`);
    await sleep(initialDelay);

    if (!ctx.session.isActivelyRunning) { closeRewardsTab(); return; }

    // ── Chain orchestrators ──────────────────────────────────────────────────
    await this._runOrchestrator(ctx, 'Explore on Bing',    this.completeExploreOnBing, () => this.completeExploreOnBing.run(ctx, mapped, startIndex));
    await this._runOrchestrator(ctx, 'Daily sets',         this.completeDailySets,     () => this.completeDailySets.run(ctx, activitiesResult));
    await this._runOrchestrator(ctx, 'PC search farming',  this.farmPcSearches,        () => this.farmPcSearches.run(ctx));

    await this._completeRun(ctx);
  }

  private async _runOrchestrator(ctx: Context, label: string, orchestrator: ActiveOrchestrator, run: () => Promise<void>): Promise<void> {
    activeOrchestrator = orchestrator;
    try {
      await run();
    } catch (err) {
      await ctx.dbg('error', `${label} failed: ${(err as Error).message}`);
    } finally {
      activeOrchestrator = null;
    }
  }

  private async _completeRun(ctx: Context): Promise<void> {
    ctx.session.isActivelyRunning = false;
    closeRewardsTab();
    await ctx.setState({ isRunning: false, status: 'Done for today!' });
    await ctx.dbg('success', 'All tasks complete');
    chrome.runtime.sendMessage({ action: MSG_ACTION.COMPLETE }).catch(() => {});
  }

  private async _abortRun(ctx: Context, status: string, errorMsg: string): Promise<void> {
    ctx.session.isActivelyRunning = false;
    closeRewardsTab();
    await ctx.setState({ isRunning: false, status });
    await ctx.dbg('error', errorMsg);
    chrome.runtime.sendMessage({ action: MSG_ACTION.COMPLETE }).catch(() => {});
  }
}

export { StartRun };
