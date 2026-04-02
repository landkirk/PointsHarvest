import { DBG } from '../util/debug.js';
import { resetState, loadState, setHeaderState } from '../util/persistent-state.js';
import { setActiveOrchestrator } from '../util/runtime-state.js';
import { openTab, removeTab } from '../util/tabs.js';
import { REWARDS_URL } from '../util/config.js';
import { createContext } from '../util/context.js';
import {
  NotLoggedInError,
  ActivityExtractionOrchestrator,
} from '../orchestrators/activity-extraction.js';
import { CompleteExploreOnBing } from '../orchestrators/complete-explore-on-bing.js';
import { CompleteDailySets } from '../orchestrators/complete-daily-sets.js';
import { FarmPcSearches } from '../orchestrators/farm-pc-searches.js';
import { WarmUpSearches } from '../orchestrators/warm-up-searches.js';
import type { Context } from '../util/context.js';
import { StoppedError } from '../interfaces/stoppable.js';
import type { OrchestratorBase } from '../interfaces/orchestrator.js';

let activeController: AbortController | null = null;

export function getActiveController(): AbortController | null {
  return activeController;
}

type AnyOrchestrator = OrchestratorBase<[]> | OrchestratorBase<[number]>;

class StartRun {
  async run(skipWarmUp = false): Promise<void> {
    const today = new Date().toDateString();

    await resetState({ isRunning: true, lastRunDate: today });
    await setHeaderState({ headerMessage: 'Starting…', activePhase: null });

    activeController = new AbortController();
    const ctx = createContext(activeController.signal);
    await ctx.broadcastProgress();

    this._executeRun(ctx, skipWarmUp) // fire and forget
      .catch((err) =>
        ctx.dbg(DBG.ERROR, `Fatal run error: ${err instanceof Error ? err.message : String(err)}`),
      );
  }

  private async _executeRun(ctx: Context, skipWarmUp: boolean): Promise<void> {
    await ctx.dbg(DBG.INFO, 'Run started');

    if (ctx.signal.aborted) return;

    let rewardsTabId: number;
    try {
      const tab = await openTab(REWARDS_URL, false);
      if (tab.id === undefined) throw new Error('Rewards tab has no ID');
      rewardsTabId = tab.id;
    } catch {
      await this._endRun(ctx, 'Failed to open Bing Rewards', 'Failed to open rewards tab', false);
      return;
    }
    await ctx.setState({ rewardsTabId });

    try {
      // ── Chain orchestrators ──────────────────────────────────────────────────
      const extraction = new ActivityExtractionOrchestrator();
      const exploreOnBing = new CompleteExploreOnBing();
      const dailySets = new CompleteDailySets();
      const farmPcSearches = new FarmPcSearches();

      await this._runOrchestrator(ctx, extraction, () => extraction.run(ctx));

      if (skipWarmUp) {
        await ctx.dbg(DBG.INFO, 'Warm-up skipped');
      } else {
        const warmUp = new WarmUpSearches();
        await this._runOrchestrator(ctx, warmUp, () => warmUp.run(ctx));
      }
      await this._runOrchestrator(ctx, exploreOnBing, () => exploreOnBing.run(ctx));
      await this._runOrchestrator(ctx, dailySets, () => dailySets.run(ctx));
      await this._runOrchestrator(ctx, farmPcSearches, () => farmPcSearches.run(ctx));
    } catch (err) {
      if (err instanceof NotLoggedInError) {
        await this._endRun(
          ctx,
          'Not logged in — sign into Bing first',
          'Aborting: not logged into Bing Rewards',
          false,
        );
        return;
      }
      throw err;
    }

    if (ctx.signal.aborted) return;
    await this._endRun(ctx, 'Done for today!', 'All tasks complete', true);
  }

  private async _runOrchestrator(
    ctx: Context,
    orchestrator: AnyOrchestrator,
    run: () => Promise<void>,
  ): Promise<void> {
    if (ctx.signal.aborted) return;
    setActiveOrchestrator(orchestrator);
    try {
      await run();
    } catch (err) {
      if (err instanceof NotLoggedInError) throw err;
      if (err instanceof StoppedError) return;
      await ctx.dbg(
        DBG.ERROR,
        `${orchestrator.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await orchestrator.stop(ctx);
      setActiveOrchestrator(null);
    }
  }

  private async _endRun(
    ctx: Context,
    status: string,
    msg: string,
    success: boolean,
  ): Promise<void> {
    activeController = null;
    const { rewardsTabId } = await loadState();
    if (rewardsTabId) removeTab(rewardsTabId);
    await ctx.setState({ isRunning: false });
    await setHeaderState({ headerMessage: status, activePhase: null });
    await ctx.dbg(success ? DBG.SUCCESS : DBG.ERROR, msg);
    await ctx.broadcastProgress();
    const iconUrl = await this._iconDataUrl();
    chrome.notifications.create({
      type: 'basic',
      iconUrl,
      title: success ? 'PointsHarvest — Done!' : 'PointsHarvest — Failed',
      message: status,
    });
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
