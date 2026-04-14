import { DBG } from '../util/debug.js';
import {
  resetRunState,
  setRunState,
  setHeaderState,
  loadRunState,
  loadPreferences,
  RUN_END,
  type RunEndReason,
} from '../util/persistent-state.js';
import { buildRunSummary } from '../util/run-summary.js';
import { setTimingMultiplier } from '../util/timing.js';
import { TabManager } from '../util/tab-manager.js';
import { REWARDS_URL } from '../util/config.js';
import { createContext } from '../util/context.js';
import { NotLoggedInError } from '../util/errors.js';
import { ActivityExtractionOrchestrator } from '../orchestrators/activity-extraction.js';
import { CompleteExploreOnBing } from '../orchestrators/complete-explore-on-bing.js';
import { CompleteDailySets } from '../orchestrators/complete-daily-sets.js';
import { FarmPcSearches } from '../orchestrators/farm-pc-searches.js';
import { WarmUpSearches } from '../orchestrators/warm-up-searches.js';
import type { Context } from '../util/context.js';
import { StoppedError } from '../interfaces/stoppable.js';
import type { OrchestratorBase } from '../interfaces/orchestrator.js';
import { FAIL } from '../util/failures.js';

const END_MESSAGES: Record<RunEndReason, { status: string; msg: string }> = {
  [RUN_END.SUCCESS]: { status: 'Done for today!', msg: 'All tasks complete' },
  [RUN_END.STOPPED]: { status: 'Stopped', msg: 'Run stopped by user' },
  [RUN_END.NOT_LOGGED_IN]: {
    status: 'Not logged in — sign into Bing first',
    msg: 'Aborting: not logged into Bing Rewards',
  },
  [RUN_END.FATAL]: { status: 'Fatal error', msg: 'Run aborted due to fatal error' },
  [RUN_END.SETUP_FAILED]: {
    status: 'Failed to open Bing Rewards',
    msg: 'Failed to open rewards tab',
  },
};

let activeController: AbortController | null = null;
let activeContext: Context | null = null;

export function getActiveController(): AbortController | null {
  return activeController;
}

export function getActiveContext(): Context | null {
  return activeContext;
}

type AnyOrchestrator = OrchestratorBase<[]> | OrchestratorBase<[number]>;

class StartRun {
  readonly tabs = new TabManager();
  private startedAt = 0;

  async run(skipWarmUp: boolean, windowId: number): Promise<void> {
    this.tabs.setWindowId(windowId);
    this.startedAt = Date.now();
    await resetRunState({ isRunning: true });
    await setHeaderState({ headerMessage: 'Starting…' });

    activeController = new AbortController();
    const prefs = await loadPreferences();
    setTimingMultiplier(prefs.timingMultiplier ?? 1.0);
    const ctx = createContext(activeController.signal);
    activeContext = ctx;
    await ctx.broadcastProgress();

    this._executeRun(ctx, skipWarmUp) // fire and forget
      .catch(async (err) => {
        await ctx.fail(
          FAIL.FATAL,
          `Fatal run error: ${err instanceof Error ? err.message : String(err)}`,
        );
        await this._endRun(ctx, RUN_END.FATAL);
      });
  }

  private async _executeRun(ctx: Context, skipWarmUp: boolean): Promise<void> {
    await ctx.dbg(DBG.INFO, 'Run started');

    if (ctx.signal.aborted) return;

    let rewardsTabId: number;
    try {
      const tab = await this.tabs.openTab(REWARDS_URL);
      this.tabs.untrackTab(tab.id); // managed by _endRun; must not be closed by orchestrator closeAll()
      this.tabs.focusTab(tab.id);
      rewardsTabId = tab.id;
    } catch {
      await ctx.fail(FAIL.TAB, 'Failed to open rewards tab');
      await this._endRun(ctx, RUN_END.SETUP_FAILED);
      return;
    }
    await ctx.setState({ rewardsTabId });

    try {
      // ── Chain orchestrators ──────────────────────────────────────────────────
      const extraction = new ActivityExtractionOrchestrator(this.tabs);
      const exploreOnBing = new CompleteExploreOnBing(this.tabs);
      const dailySets = new CompleteDailySets(this.tabs);
      const farmPcSearches = new FarmPcSearches(this.tabs);

      await this._runOrchestrator(ctx, extraction, () => extraction.run(ctx));

      if (skipWarmUp) {
        await ctx.dbg(DBG.INFO, 'Warm-up skipped');
      } else {
        const warmUp = new WarmUpSearches(this.tabs);
        await this._runOrchestrator(ctx, warmUp, () => warmUp.run(ctx));
      }
      await this._runOrchestrator(ctx, exploreOnBing, () => exploreOnBing.run(ctx));
      await this._runOrchestrator(ctx, dailySets, () => dailySets.run(ctx));
      await this._runOrchestrator(ctx, farmPcSearches, () => farmPcSearches.run(ctx));
    } catch (err) {
      if (err instanceof NotLoggedInError) {
        await this._endRun(ctx, RUN_END.NOT_LOGGED_IN);
        return;
      }
      throw err;
    }

    if (ctx.signal.aborted) {
      await this._endRun(ctx, RUN_END.STOPPED);
      return;
    }
    await this._endRun(ctx, RUN_END.SUCCESS);
  }

  private async _runOrchestrator(
    ctx: Context,
    orchestrator: AnyOrchestrator,
    run: () => Promise<void>,
  ): Promise<void> {
    if (ctx.signal.aborted) return;
    ctx.activeOrchestrator = orchestrator;
    try {
      await run();
    } catch (err) {
      if (err instanceof NotLoggedInError) throw err;
      if (err instanceof StoppedError) return;
      await ctx.fail(
        FAIL.FATAL,
        `${orchestrator.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await orchestrator.stop(ctx);
      ctx.activeOrchestrator = null;
    }
  }

  private async _endRun(ctx: Context, endReason: RunEndReason): Promise<void> {
    activeController = null;
    activeContext = null;
    await this.tabs.closeAll();
    const [run, prefs] = await Promise.all([loadRunState(), loadPreferences()]);
    if (run.rewardsTabId) this.tabs.closeTab(run.rewardsTabId);

    const { status, msg } = END_MESSAGES[endReason];
    const success = endReason === RUN_END.SUCCESS;
    const summary = buildRunSummary(run, {
      startedAt: this.startedAt,
      endedAt: Date.now(),
      endReason,
    });

    await setRunState({
      isRunning: false,
      lastRunSummary: summary,
      header: { ...run.header, headerMessage: status, activePhase: null },
    });
    await ctx.dbg(success ? DBG.SUCCESS : DBG.ERROR, msg);
    await ctx.broadcastProgress();
    if (!prefs.disableNotifications && !ctx.signal.aborted) {
      const iconUrl = await this._iconDataUrl();
      chrome.notifications.create({
        type: 'basic',
        iconUrl,
        title: success ? 'PointsHarvest — Done!' : 'PointsHarvest — Failed',
        message: status,
      });
    }
  }

  private async _iconDataUrl(): Promise<string> {
    const buf = await fetch(chrome.runtime.getURL('icons/icon1024.png')).then((r) =>
      r.arrayBuffer(),
    );
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return `data:image/png;base64,${btoa(binary)}`;
  }
}

export { StartRun };
