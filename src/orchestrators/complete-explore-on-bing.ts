// Iterates through the mapped activity list, clicking each card on the rewards
// page and waiting for the resulting search tab to load and dwell.

import { LABEL_MAX, pluralize, truncate } from '../util/format.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { executeWithRetry } from '../util/execute-with-retry.js';
import { FAIL } from '../util/failures.js';
import { loadRunState } from '../util/persistent-state.js';
import { PHASE } from '../util/phase.js';

import { sumCompleted, ACTIVITY_TYPE, CardState } from '../util/activity.js';
import type { Activity } from '../util/activity.js';
import { performSearch } from '../steps/perform-search.js';
import { validateActivity, ValidationStatus } from '../steps/validate-activity.js';
import { TabCaptureStatus } from '../util/tab-manager.js';
import { runActivityLoop } from '../util/run-activity-loop.js';

class CompleteExploreOnBing extends OrchestratorBase<[]> {
  readonly name = 'Explore on Bing';

  async run(ctx: Context): Promise<void> {
    ctx.signal.throwIfAborted();
    const extraction = (await loadRunState()).activityState ?? null;
    if (!extraction || !extraction.rewardsTabId) {
      await ctx.dbg(DBG.WARN, 'No extraction result — skipping explore on bing');
      return;
    }

    const { rewardsTabId } = extraction;
    const allExplore = extraction.allActivities.filter(
      (a) => a.activityType === ACTIVITY_TYPE.EXPLORE_ON_BING,
    );
    const { count: alreadyCompletedCount, points: alreadyCompletedPoints } =
      sumCompleted(allExplore);

    if (!(await this.tabs.assertTabExists(ctx, rewardsTabId, 'explore on bing'))) return;

    const activities = allExplore.filter((a) => a.cardState === CardState.Actionable);

    await ctx.dbg(
      DBG.INFO,
      `Found ${activities.length} actionable ${pluralize(activities.length, 'activity', 'activities')}`,
    );

    const unmapped = activities.filter((a) => a.searchQuery === null).length;
    await ctx.dbg(
      DBG.INFO,
      `Mapped ${activities.length - unmapped}/${activities.length} ${pluralize(activities.length, 'activity', 'activities')} (${unmapped} unmatched)`,
    );

    const phaseTotal = alreadyCompletedCount + activities.length;

    await runActivityLoop({
      ctx,
      phase: PHASE.EXPLORE,
      activities,
      alreadyCompletedCount,
      alreadyCompletedPoints,
      lingerLabel: 'between explore on bing searches',
      statusLine: (a) => `Searching: "${truncate(a.searchQuery ?? a.title, LABEL_MAX)}"`,
      skip: (a) =>
        a.searchQuery ? null : `Skipping card — no query could be generated for "${a.title}"`,
      attempt: async (a, _i, progress) => {
        const { searchQuery, fallbackQuery } = a;
        if (!searchQuery) return false;
        const queries = fallbackQuery ? [searchQuery, fallbackQuery] : [searchQuery];
        return await executeWithRetry(
          ctx,
          (attempt) => this.runSearchForActivity(ctx, a, queries[attempt - 1]!, rewardsTabId),
          {
            maxAttempts: queries.length,
            lingerLabel: 'explore on bing validation retry',
            retryLogMessage: fallbackQuery
              ? `Validation failed — retrying with lookup query: "${fallbackQuery}"`
              : undefined,
            retryHeaderPayload: fallbackQuery
              ? {
                  phase: PHASE.EXPLORE,
                  headerMessage: `Retrying: "${truncate(fallbackQuery, LABEL_MAX)}"`,
                  progress: { done: progress.done, total: phaseTotal },
                  points: progress.points,
                }
              : undefined,
          },
          {
            category: FAIL.VALIDATION,
            message: fallbackQuery
              ? `Validation failed after retry for: "${searchQuery}"`
              : `Validation failed — no lookup query for: "${searchQuery}"`,
          },
        );
      },
    });
  }

  private async runSearchForActivity(
    ctx: Context,
    activity: Activity,
    searchQuery: string,
    rewardsTabId: number,
  ): Promise<boolean> {
    let result = await this.tabs.clickCardAndCaptureTab(
      ctx,
      rewardsTabId,
      activity.id,
      activity.title,
    );
    if (result.status === TabCaptureStatus.Blocked) {
      await this._waitForPopupUnblock(ctx, activity.title);
      ctx.signal.throwIfAborted();
      result = await this.tabs.clickCardAndCaptureTab(
        ctx,
        rewardsTabId,
        activity.id,
        activity.title,
      );
    }
    if (result.status !== TabCaptureStatus.Ok) return false;
    const searchTab = result.tab;

    ctx.signal.throwIfAborted();
    await performSearch._run(ctx, searchTab.id, searchQuery);
    await this.tabs.closeTabWithChildren(searchTab.id);
    ctx.signal.throwIfAborted();

    const r = await validateActivity._run(ctx, activity, rewardsTabId);
    return r.status === ValidationStatus.Completed;
  }
}

export { CompleteExploreOnBing };
