// Iterates through the mapped activity list, clicking each card on the rewards
// page and waiting for the resulting search tab to load and dwell.

import { lingerOnPage } from '../util/timing.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { PHASE, loadState } from '../util/state.js';

import { markActivityCompleted, ACTIVITY_TYPE, CardState } from '../util/activity.js';
import type { Activity } from '../util/activity.js';
import { performSearch } from '../steps/perform-search.js';
import { validateActivity, ValidationStatus } from '../steps/validate-activity.js';

class CompleteExploreOnBing extends OrchestratorBase<[]> {
  readonly name = 'Explore on Bing';
  private rewardsTabId: number | null = null;

  async run(ctx: Context): Promise<void> {
    this.checkStopped();
    const extraction = (await loadState()).activityState ?? null;
    if (!extraction || !extraction.rewardsTabId) {
      await ctx.dbg(DBG.WARN, 'No extraction result — skipping explore on bing');
      return;
    }

    const { rewardsTabId, alreadyCompletedCount, alreadyCompletedPoints } = extraction;

    if (!(await this.assertRewardsTabExists(ctx, rewardsTabId, 'explore on bing'))) return;

    const activities = extraction.allActivities.filter(
      (a) =>
        a.activityType === ACTIVITY_TYPE.EXPLORE_ON_BING && a.cardState === CardState.Actionable,
    );

    this.rewardsTabId = rewardsTabId;
    await ctx.dbg(
      DBG.INFO,
      `Found ${activities.length} actionable activit${activities.length === 1 ? 'y' : 'ies'}`,
    );

    const unmapped = activities.filter((a) => a.searchQuery === null).length;
    await ctx.dbg(
      DBG.INFO,
      `Mapped ${activities.length - unmapped}/${activities.length} activit${activities.length === 1 ? 'y' : 'ies'} (${unmapped} unmatched)`,
    );

    const phaseTotal = alreadyCompletedCount + activities.length;
    let earnedPts = alreadyCompletedPoints;
    await ctx.updateHeader({
      headerMessage: `Explore on Bing (${alreadyCompletedCount} / ${phaseTotal})`,
      activePhase: PHASE.EXPLORE,
      phaseProgress: { done: alreadyCompletedCount, total: phaseTotal },
      phasePoints: { explore: earnedPts },
    });

    for (let i = 0; i < activities.length; i++) {
      this.checkStopped();

      const { id, searchQuery, title, fallbackQuery, points } = activities[i];

      if (!searchQuery) {
        await ctx.dbg(
          DBG.WARN,
          `Skipping card ${i + 1} — no query could be generated for "${title}"`,
        );
        continue;
      }

      const label = searchQuery.length > 40 ? searchQuery.slice(0, 40) + '…' : searchQuery;
      await ctx.updateHeader({
        headerMessage: `Searching: "${label}"`,
        activePhase: PHASE.EXPLORE,
        phaseProgress: { done: alreadyCompletedCount + i, total: phaseTotal },
        phasePoints: { explore: earnedPts },
      });
      await ctx.dbg(DBG.INFO, `[${id}] [${i + 1}/${activities.length}] Clicking card: "${title}"`);

      const succeeded = await this.executeActivityWithValidation(
        ctx,
        () => this.runSearchForActivity(ctx, activities[i], searchQuery),
        fallbackQuery ? () => this.runSearchForActivity(ctx, activities[i], fallbackQuery) : null,
        {
          retryLogMessage: `Validation failed — retrying with lookup query: "${fallbackQuery}"`,
          lingerLabel: 'explore on bing validation retry',
          failCategory: 'validation',
          failMessage: `Validation failed after retry for: "${searchQuery}"`,
          noRetryFailMessage: `Validation failed — no lookup query for: "${searchQuery}"`,
          retryHeaderPayload: fallbackQuery
            ? {
                headerMessage: `Retrying: "${fallbackQuery.length > 40 ? fallbackQuery.slice(0, 40) + '…' : fallbackQuery}"`,
                activePhase: PHASE.EXPLORE,
                phaseProgress: { done: alreadyCompletedCount + i, total: phaseTotal },
                phasePoints: { explore: earnedPts },
              }
            : undefined,
        },
      );
      if (!succeeded) continue;

      await markActivityCompleted(id);
      earnedPts += points;
      const completed = i + 1;
      await ctx.dbg(DBG.SUCCESS, `[${id}] Search ${completed}/${activities.length} complete`);
      this.checkStopped();

      await ctx.updateHeader({
        headerMessage: `Explore on Bing (${alreadyCompletedCount + completed} / ${phaseTotal})`,
        activePhase: PHASE.EXPLORE,
        phaseProgress: { done: alreadyCompletedCount + completed, total: phaseTotal },
        phasePoints: { explore: earnedPts },
      });

      if (i < activities.length - 1) {
        await lingerOnPage('between explore on bing searches');
        this.checkStopped();
      }
    }
  }

  private async runSearchForActivity(
    ctx: Context,
    activity: Activity,
    searchQuery: string,
  ): Promise<boolean | null> {
    const rewardsTabId = this.rewardsTabId;
    if (rewardsTabId === null) throw new Error('rewardsTabId not initialized');
    const searchTab = await this.clickCardAndCaptureTab(
      ctx,
      rewardsTabId,
      activity.id,
      activity.title,
    );
    if (!searchTab) return null;

    chrome.tabs.update(searchTab.id, { active: true }).catch(() => {
      /* non-critical: tab may have closed before we activated it */
    });
    await this.waitForTabLoad(searchTab.id, 30000);
    this.checkStoppedOrCloseTab(searchTab.id);
    await performSearch.run(ctx, searchTab.id, searchQuery);
    this.closeTab(searchTab.id);
    this.checkStopped();

    const r = await validateActivity.run(ctx, activity, rewardsTabId);
    return r.status === ValidationStatus.Completed
      ? true
      : r.status === ValidationStatus.Incomplete
        ? false
        : null;
  }
}

export { CompleteExploreOnBing };
