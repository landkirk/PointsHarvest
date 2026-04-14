// Iterates through the mapped activity list, clicking each card on the rewards
// page and waiting for the resulting search tab to load and dwell.

import { LABEL_MAX } from '../util/timing.js';
import { pluralize } from '../util/format.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { executeWithRetry } from '../util/execute-with-retry.js';
import { PHASE, loadRunState } from '../util/persistent-state.js';

import { sumCompleted, ACTIVITY_TYPE, CardState } from '../util/activity.js';
import type { Activity } from '../util/activity.js';
import { performSearch } from '../steps/perform-search.js';
import { validateActivity, ValidationStatus } from '../steps/validate-activity.js';
import { TabCaptureStatus } from '../util/tab-manager.js';
import { runActivityLoop } from '../util/run-activity-loop.js';

const truncate = (s: string) => (s.length > LABEL_MAX ? s.slice(0, LABEL_MAX) + '…' : s);

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
      phaseLabel: 'Explore on Bing',
      activities,
      alreadyCompletedCount,
      alreadyCompletedPoints,
      lingerLabel: 'between explore on bing searches',
      statusLine: (a) => `Searching: "${truncate(a.searchQuery ?? a.title)}"`,
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
                  headerMessage: `Retrying: "${truncate(fallbackQuery)}"`,
                  activePhase: PHASE.EXPLORE,
                  phaseProgress: { done: progress.done, total: phaseTotal },
                  phasePoints: { explore: progress.points },
                }
              : undefined,
          },
          {
            category: 'validation',
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
    const result = await this.tabs.clickCardAndCaptureTab(
      ctx,
      rewardsTabId,
      activity.id,
      activity.title,
    );
    if (result.status === TabCaptureStatus.Failed) return false;
    if (result.status === TabCaptureStatus.Blocked) {
      await this._waitForPopupUnblock(ctx, activity.title);
      return false;
    }
    const searchTab = result.tab;

    ctx.signal.throwIfAborted();
    await performSearch._run(ctx, searchTab.id, searchQuery);
    this.tabs.closeTab(searchTab.id);
    ctx.signal.throwIfAborted();

    const r = await validateActivity._run(ctx, activity, rewardsTabId);
    return r.status === ValidationStatus.Completed;
  }
}

export { CompleteExploreOnBing };
