// Opens each daily set activity in a background tab by index, dwells briefly, then closes.
// Activities matching quiz/poll/test/puzzle keywords linger until the user signals completion.

import { lingerOnPage } from '../util/timing.js';
import { ACTIVITY_TYPE, CardState, markActivityCompleted, sumCompleted } from '../util/activity.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { ActivityRunner } from '../util/activity-runner.js';
import { PHASE, loadRunState } from '../util/persistent-state.js';
import { lingerOnTab, type LingerHandle } from '../steps/linger-on-tab.js';
import { validateActivity, ValidationStatus } from '../steps/validate-activity.js';
import type { Activity } from '../util/activity.js';
import { TabCaptureStatus } from '../util/tab-manager.js';

class CompleteDailySets extends OrchestratorBase {
  readonly name = 'Daily sets';
  private currentLinger: LingerHandle | null = null;

  async run(ctx: Context): Promise<void> {
    ctx.signal.throwIfAborted();
    const extraction = (await loadRunState()).activityState ?? null;
    if (!extraction || !extraction.rewardsTabId) {
      await ctx.dbg(DBG.WARN, 'No extraction result — skipping daily sets');
      return;
    }

    const { rewardsTabId } = extraction;
    const allDailyActivities = extraction.allActivities.filter(
      (a) => a.activityType === ACTIVITY_TYPE.DAILY_SET,
    );
    const { count: dailyAlreadyCompletedCount, points: dailyAlreadyCompletedPoints } =
      sumCompleted(allDailyActivities);

    if (!(await this.tabs.assertTabExists(ctx, rewardsTabId, 'daily sets'))) return;

    const dailySets = extraction.allActivities.filter(
      (a) => a.activityType === ACTIVITY_TYPE.DAILY_SET && a.cardState === CardState.Actionable,
    );

    const dailyPhaseTotal = dailyAlreadyCompletedCount + dailySets.length;
    let earnedPts = dailyAlreadyCompletedPoints;
    let successCount = 0;
    await ctx.updateHeader({
      headerMessage: `Daily sets (${dailyAlreadyCompletedCount} / ${dailyPhaseTotal})`,
      activePhase: PHASE.DAILY,
      phaseProgress: { done: dailyAlreadyCompletedCount, total: dailyPhaseTotal },
      phasePoints: { daily: earnedPts },
    });
    if (dailySets.length === 0) {
      await ctx.dbg(DBG.INFO, 'No actionable daily set activities — skipping');
      return;
    }

    await ctx.dbg(DBG.INFO, `Starting daily sets: ${dailySets.length} activity/activities`);

    for (let i = 0; i < dailySets.length; i++) {
      ctx.signal.throwIfAborted();
      ctx.activeActivity = dailySets[i];
      try {
        const label = dailySets[i].title.slice(0, 60);
        await ctx.dbg(
          DBG.INFO,
          `[${dailySets[i].id}] [Daily set ${i + 1}/${dailySets.length}] Opening: "${label}"`,
        );

        const attempt = () => this.attemptActivity(ctx, rewardsTabId, dailySets[i]);
        const succeeded = await ActivityRunner.executeActivityWithValidation(
          ctx,
          attempt,
          attempt,
          {
            retryLogMessage: `Daily set activity ${i + 1} not validated — retrying`,
            lingerLabel: 'daily set activity retry',
            failCategory: 'validation',
            failMessage: `Daily set activity ${i + 1} still not validated after retry — skipping`,
            navFailMessage: `Failed to open tab for daily set activity ${i + 1}`,
            retryNavFailMessage: `Retry: failed to open tab for daily set activity ${i + 1}`,
          },
        );
        if (!succeeded) continue;

        await markActivityCompleted(dailySets[i].id);
        earnedPts += dailySets[i].points;
        successCount++;
        ctx.signal.throwIfAborted();
        await ctx.dbg(
          DBG.SUCCESS,
          `[${dailySets[i].id}] Daily set activity ${successCount}/${dailySets.length} complete`,
        );
        await ctx.updateHeader({
          headerMessage: `Daily sets (${dailyAlreadyCompletedCount + successCount} / ${dailyPhaseTotal})`,
          activePhase: PHASE.DAILY,
          phaseProgress: {
            done: dailyAlreadyCompletedCount + successCount,
            total: dailyPhaseTotal,
          },
          phasePoints: { daily: earnedPts },
        });

        if (i < dailySets.length - 1) {
          await lingerOnPage('between daily set activities', undefined, ctx.signal);
          ctx.signal.throwIfAborted();
        }
      } finally {
        ctx.activeActivity = null;
      }
    }

    await ctx.dbg(DBG.SUCCESS, 'Completed daily set activities');
  }

  private async attemptActivity(
    ctx: Context,
    rewardsTabId: number,
    activity: Activity,
  ): Promise<boolean> {
    const { title } = activity;
    const label = title.slice(0, 60);
    const result = await this.tabs.clickCardAndCaptureTab(ctx, rewardsTabId, activity.id, label);
    if (result.status === TabCaptureStatus.Failed) return false;
    if (result.status === TabCaptureStatus.Blocked) {
      await this._waitForPopupUnblock(ctx, label);
      return false;
    }
    const t = result.tab;

    ctx.signal.throwIfAborted();

    if (activity.requiresUserAction) {
      await ctx.dbg(DBG.INFO, 'User action required — waiting for completion');
      const linger = lingerOnTab(ctx, t.id, activity.userActionTimeoutMs);
      this.currentLinger = linger;
      await linger.promise;
      this.currentLinger = null;
    } else {
      await lingerOnPage('daily set activity', undefined, ctx.signal);
      ctx.signal.throwIfAborted();
      this.tabs.closeTab(t.id);
    }
    ctx.signal.throwIfAborted();
    const validated = await validateActivity._run(ctx, activity, rewardsTabId);
    return validated.status === ValidationStatus.Completed;
  }

  private _resolveLinger(closeTab: boolean): void {
    if (!this.currentLinger) return;
    const linger = this.currentLinger;
    this.currentLinger = null;
    if (closeTab) this.tabs.closeTab(linger.tabId);
    else this.tabs.untrackTab(linger.tabId);
    linger.resolve();
  }

  override onTabRemoved(tabId: number): void {
    if (this.currentLinger?.tabId === tabId) this._resolveLinger(false);
  }

  override onUserActionComplete(): void {
    super.onUserActionComplete();
    this._resolveLinger(true);
  }

  protected override async _onStop(_ctx: Context): Promise<void> {
    await super._onStop(_ctx);
    this._resolveLinger(true);
  }
}

export { CompleteDailySets };
