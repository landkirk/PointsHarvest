// Iterates through the mapped activity list, clicking each card on the rewards
// page and waiting for the resulting search tab to load and dwell.

import { lingerOnPage, LABEL_MAX } from '../util/timing.js';
import { pluralize } from '../util/format.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { ActivityRunner } from '../util/activity-runner.js';
import { PHASE, loadRunState } from '../util/persistent-state.js';

import { markActivityCompleted, sumCompleted, ACTIVITY_TYPE, CardState } from '../util/activity.js';
import type { Activity } from '../util/activity.js';
import { performSearch } from '../steps/perform-search.js';
import { validateActivity, ValidationStatus } from '../steps/validate-activity.js';
import { TabCaptureStatus } from '../util/tab-manager.js';

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
    const exploreActivities = extraction.allActivities.filter(
      (a) => a.activityType === ACTIVITY_TYPE.EXPLORE_ON_BING,
    );
    const { count: alreadyCompletedCount, points: alreadyCompletedPoints } =
      sumCompleted(exploreActivities);

    if (!(await this.tabs.assertTabExists(ctx, rewardsTabId, 'explore on bing'))) return;

    const activities = extraction.allActivities.filter(
      (a) =>
        a.activityType === ACTIVITY_TYPE.EXPLORE_ON_BING && a.cardState === CardState.Actionable,
    );

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
    let earnedPts = alreadyCompletedPoints;
    let successCount = 0;
    await ctx.updateHeader({
      headerMessage: `Explore on Bing (${alreadyCompletedCount} / ${phaseTotal})`,
      activePhase: PHASE.EXPLORE,
      phaseProgress: { done: alreadyCompletedCount, total: phaseTotal },
      phasePoints: { explore: earnedPts },
    });

    const truncate = (s: string) => (s.length > LABEL_MAX ? s.slice(0, LABEL_MAX) + '…' : s);
    for (let i = 0; i < activities.length; i++) {
      ctx.signal.throwIfAborted();
      ctx.activeActivity = activities[i];
      try {
        const { id, searchQuery, title, fallbackQuery, points } = activities[i];

        if (!searchQuery) {
          await ctx.dbg(
            DBG.WARN,
            `Skipping card ${i + 1} — no query could be generated for "${title}"`,
          );
          continue;
        }

        const label = truncate(searchQuery);
        await ctx.updateHeader({
          headerMessage: `Searching: "${label}"`,
          activePhase: PHASE.EXPLORE,
          phaseProgress: { done: alreadyCompletedCount + successCount, total: phaseTotal },
          phasePoints: { explore: earnedPts },
        });
        await ctx.dbg(
          DBG.INFO,
          `[${id}] [${i + 1}/${activities.length}] Clicking card: "${title}"`,
        );

        const succeeded = await ActivityRunner.executeActivityWithValidation(
          ctx,
          () => this.runSearchForActivity(ctx, activities[i], searchQuery, rewardsTabId),
          fallbackQuery
            ? () => this.runSearchForActivity(ctx, activities[i], fallbackQuery, rewardsTabId)
            : null,
          {
            retryLogMessage: `Validation failed — retrying with lookup query: "${fallbackQuery}"`,
            lingerLabel: 'explore on bing validation retry',
            failCategory: 'validation',
            failMessage: `Validation failed after retry for: "${searchQuery}"`,
            noRetryFailMessage: `Validation failed — no lookup query for: "${searchQuery}"`,
            retryHeaderPayload: fallbackQuery
              ? {
                  headerMessage: `Retrying: "${truncate(fallbackQuery)}"`,
                  activePhase: PHASE.EXPLORE,
                  phaseProgress: { done: alreadyCompletedCount + successCount, total: phaseTotal },
                  phasePoints: { explore: earnedPts },
                }
              : undefined,
          },
        );
        if (!succeeded) continue;

        await markActivityCompleted(id);
        earnedPts += points;
        successCount++;
        await ctx.dbg(DBG.SUCCESS, `[${id}] Search ${successCount}/${activities.length} complete`);
        ctx.signal.throwIfAborted();

        await ctx.updateHeader({
          headerMessage: `Explore on Bing (${alreadyCompletedCount + successCount} / ${phaseTotal})`,
          activePhase: PHASE.EXPLORE,
          phaseProgress: { done: alreadyCompletedCount + successCount, total: phaseTotal },
          phasePoints: { explore: earnedPts },
        });

        if (i < activities.length - 1) {
          await lingerOnPage('between explore on bing searches', undefined, ctx.signal);
          ctx.signal.throwIfAborted();
        }
      } finally {
        ctx.activeActivity = null;
      }
    }
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
