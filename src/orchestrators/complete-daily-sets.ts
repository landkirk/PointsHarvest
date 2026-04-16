// Opens each daily set activity in a background tab by index, dwells briefly, then closes.
// Activities matching quiz/poll/test/puzzle keywords linger until the user signals completion.

import { LABEL_MAX, pluralize, truncate } from '../util/format.js';
import { ACTIVITY_TYPE, CardState, sumCompleted } from '../util/activity.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { executeWithRetry } from '../util/execute-with-retry.js';
import { FAIL } from '../util/failures.js';
import { PHASE, loadRunState } from '../util/persistent-state.js';
import { lingerOnPage } from '../util/timing.js';
import { lingerOnTab, type LingerHandle } from '../steps/linger-on-tab.js';
import { validateActivity, ValidationStatus } from '../steps/validate-activity.js';
import type { Activity } from '../util/activity.js';
import { TabCaptureStatus } from '../util/tab-manager.js';
import { runActivityLoop } from '../util/run-activity-loop.js';

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
    const allDaily = extraction.allActivities.filter(
      (a) => a.activityType === ACTIVITY_TYPE.DAILY_SET,
    );
    const { count: alreadyCompletedCount, points: alreadyCompletedPoints } = sumCompleted(allDaily);

    if (!(await this.tabs.assertTabExists(ctx, rewardsTabId, 'daily sets'))) return;

    const dailySets = allDaily.filter((a) => a.cardState === CardState.Actionable);

    if (dailySets.length === 0) {
      await ctx.dbg(DBG.INFO, 'No actionable daily set activities — skipping');
    } else {
      await ctx.dbg(
        DBG.INFO,
        `Starting daily sets: ${dailySets.length} ${pluralize(dailySets.length, 'activity', 'activities')}`,
      );
    }

    await runActivityLoop({
      ctx,
      phase: PHASE.DAILY,
      phaseLabel: 'Daily sets',
      activities: dailySets,
      alreadyCompletedCount,
      alreadyCompletedPoints,
      lingerLabel: 'between daily set activities',
      statusLine: (a) => `Opening: "${truncate(a.title, LABEL_MAX)}"`,
      attempt: async (a, i) =>
        executeWithRetry(
          ctx,
          () => this.attemptActivity(ctx, rewardsTabId, a),
          {
            maxAttempts: 2,
            retryLogMessage: `Daily set activity ${i + 1} not validated — retrying`,
            lingerLabel: 'daily set activity retry',
          },
          {
            category: FAIL.VALIDATION,
            message: `Daily set activity ${i + 1} still not validated after retry — skipping`,
          },
        ),
    });
  }

  private async attemptActivity(
    ctx: Context,
    rewardsTabId: number,
    activity: Activity,
  ): Promise<boolean> {
    const { title } = activity;
    const result = await this.tabs.clickCardAndCaptureTab(ctx, rewardsTabId, activity.id, title);
    if (result.status === TabCaptureStatus.Failed) return false;
    if (result.status === TabCaptureStatus.Blocked) {
      await this._waitForPopupUnblock(ctx, title);
      return false;
    }
    const t = result.tab;

    ctx.signal.throwIfAborted();

    if (activity.requiresUserAction) {
      await ctx.dbg(DBG.INFO, 'User action required — waiting for completion');
      const linger = lingerOnTab(ctx, t.id, activity);
      this.currentLinger = linger;
      await linger.promise;
      this.currentLinger = null;
    } else {
      await lingerOnPage('daily set activity', undefined, ctx.signal);
      ctx.signal.throwIfAborted();
      await this.tabs.closeTabWithChildren(t.id);
    }
    ctx.signal.throwIfAborted();
    const validated = await validateActivity._run(ctx, activity, rewardsTabId);
    return validated.status === ValidationStatus.Completed;
  }

  private _resolveLinger(closeTab: boolean): void {
    if (!this.currentLinger) return;
    const linger = this.currentLinger;
    this.currentLinger = null;
    if (closeTab) void this.tabs.closeTabWithChildren(linger.tabId);
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
