import { LABEL_MAX, pluralize, truncate } from '../util/format.js';
import { ACTIVITY_TYPE, CardState, sumCompleted } from '../util/activity.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { executeWithRetry } from '../util/execute-with-retry.js';
import { FAIL } from '../util/failures.js';
import { PHASE, loadRunState } from '../util/persistent-state.js';
import { lingerOnPage } from '../util/timing.js';
import { validateActivity, ValidationStatus } from '../steps/validate-activity.js';
import type { Activity } from '../util/activity.js';
import { TabCaptureStatus } from '../util/tab-manager.js';
import { runActivityLoop } from '../util/run-activity-loop.js';

class CompleteMoreActivities extends OrchestratorBase {
  readonly name = 'More activities';

  async run(ctx: Context): Promise<void> {
    ctx.signal.throwIfAborted();
    const extraction = (await loadRunState()).activityState ?? null;
    if (!extraction || !extraction.rewardsTabId) {
      await ctx.dbg(DBG.WARN, 'No extraction result — skipping more activities');
      return;
    }

    const { rewardsTabId } = extraction;
    const all = extraction.allActivities.filter(
      (a) => a.activityType === ACTIVITY_TYPE.MORE_ACTIVITIES,
    );
    const { count: alreadyCompletedCount, points: alreadyCompletedPoints } = sumCompleted(all);

    if (!(await this.tabs.assertTabExists(ctx, rewardsTabId, 'more activities'))) return;

    const actionable = all.filter((a) => a.cardState === CardState.Actionable);

    if (actionable.length === 0) {
      await ctx.dbg(DBG.INFO, 'No actionable more activities tiles — skipping');
    } else {
      await ctx.dbg(
        DBG.INFO,
        `Starting more activities: ${actionable.length} ${pluralize(actionable.length, 'tile', 'tiles')}`,
      );
    }

    await runActivityLoop({
      ctx,
      phase: PHASE.MORE_ACTIVITIES,
      phaseLabel: 'More activities',
      activities: actionable,
      alreadyCompletedCount,
      alreadyCompletedPoints,
      lingerLabel: 'between more activities tiles',
      statusLine: (a) => `Opening: "${truncate(a.title, LABEL_MAX)}"`,
      attempt: async (a, i) =>
        executeWithRetry(
          ctx,
          () => this.attemptActivity(ctx, rewardsTabId, a),
          {
            maxAttempts: 2,
            retryLogMessage: `More activities tile ${i + 1} not validated — retrying`,
            lingerLabel: 'more activities retry',
          },
          {
            category: FAIL.VALIDATION,
            message: `More activities tile ${i + 1} still not validated after retry — skipping`,
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
    ctx.signal.throwIfAborted();
    await lingerOnPage('more activities tile', undefined, ctx.signal);
    ctx.signal.throwIfAborted();
    await this.tabs.closeTabWithChildren(result.tab.id);
    ctx.signal.throwIfAborted();
    const validated = await validateActivity._run(ctx, activity, rewardsTabId);
    return validated.status === ValidationStatus.Completed;
  }
}

export { CompleteMoreActivities };
