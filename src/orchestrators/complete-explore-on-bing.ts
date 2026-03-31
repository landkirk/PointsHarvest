// Iterates through the mapped activity list, clicking each card on the rewards
// page and waiting for the resulting search tab to load and dwell.

import { lingerOnPage } from '../util/timing.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { PHASE, loadState } from '../util/state.js';

import {
  buildSearchList,
  findRetryQuery,
  markActivityCompleted,
  ACTIVITY_TYPE,
  CardState,
} from '../util/activity.js';
import type { MappedActivity } from '../util/activity.js';
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
    const activities = extraction.allActivities.filter(
      (a) =>
        a.activityType === ACTIVITY_TYPE.EXPLORE_ON_BING && a.cardState === CardState.Actionable,
    );

    this.rewardsTabId = rewardsTabId;
    this.openedTabIds.add(rewardsTabId);
    await ctx.dbg(
      DBG.INFO,
      `Found ${activities.length} actionable activit${activities.length === 1 ? 'y' : 'ies'}`,
    );

    const mapped = buildSearchList(activities);
    await ctx.setState({ mappedActivities: mapped });

    const unmapped = mapped.filter((m) => m.query === null).length;
    await ctx.dbg(
      DBG.INFO,
      `Mapped ${mapped.length - unmapped}/${mapped.length} activit${mapped.length === 1 ? 'y' : 'ies'} (${unmapped} unmatched)`,
    );

    const phaseTotal = alreadyCompletedCount + mapped.length;
    let earnedPts = alreadyCompletedPoints;
    await ctx.updateHeader({
      headerMessage: `Explore on Bing (${alreadyCompletedCount} / ${phaseTotal})`,
      activePhase: PHASE.EXPLORE,
      phaseProgress: { done: alreadyCompletedCount, total: phaseTotal },
      phasePoints: { explore: earnedPts },
    });

    try {
      for (let i = 0; i < mapped.length; i++) {
        this.checkStopped();

        const { query, title } = mapped[i];

        if (!query) {
          await ctx.dbg(
            DBG.WARN,
            `Skipping card ${i + 1} — no query could be generated for "${title}"`,
          );
          continue;
        }

        const label = query.length > 40 ? query.slice(0, 40) + '…' : query;
        await ctx.updateHeader({
          headerMessage: `Searching: "${label}"`,
          activePhase: PHASE.EXPLORE,
          phaseProgress: { done: alreadyCompletedCount + i, total: phaseTotal },
          phasePoints: { explore: earnedPts },
        });
        await ctx.dbg(
          DBG.INFO,
          `[${mapped[i].id}] [${i + 1}/${mapped.length}] Clicking card: "${title}"`,
        );

        const retryQuery = findRetryQuery(query);
        const succeeded = await this.executeActivityWithValidation(
          ctx,
          () => this.runSearchForActivity(ctx, mapped[i], query),
          retryQuery ? () => this.runSearchForActivity(ctx, mapped[i], retryQuery) : null,
          {
            retryLogMessage: `Validation failed — retrying with lookup query: "${retryQuery}"`,
            lingerLabel: 'explore on bing validation retry',
            failCategory: 'validation',
            failMessage: `Validation failed after retry for: "${query}"`,
            noRetryFailMessage: `Validation failed — no lookup query for: "${query}"`,
          },
        );
        if (!succeeded) continue;

        await markActivityCompleted(mapped[i].id);
        earnedPts += mapped[i].points;
        const completed = i + 1;
        await ctx.dbg(
          DBG.SUCCESS,
          `[${mapped[i].id}] Search ${completed}/${mapped.length} complete`,
        );
        this.checkStopped();

        await ctx.updateHeader({
          headerMessage: `Explore on Bing (${alreadyCompletedCount + completed} / ${phaseTotal})`,
          activePhase: PHASE.EXPLORE,
          phaseProgress: { done: alreadyCompletedCount + completed, total: phaseTotal },
          phasePoints: { explore: earnedPts },
        });

        if (i < mapped.length - 1) {
          await lingerOnPage('between explore on bing searches');
          this.checkStopped();
        }
      }
    } finally {
      if (this.rewardsTabId) {
        this.closeTab(this.rewardsTabId);
        this.rewardsTabId = null;
      }
    }
  }

  private async runSearchForActivity(
    ctx: Context,
    activity: MappedActivity,
    query: string,
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
    await performSearch.run(ctx, searchTab.id, query);
    this.closeTab(searchTab.id);
    this.checkStopped();

    const r = await validateActivity.run(ctx, activity, rewardsTabId);
    return r.status === ValidationStatus.Completed
      ? true
      : r.status === ValidationStatus.Incomplete
        ? false
        : null;
  }

  protected async _onStop(_ctx: Context): Promise<void> {
    this.rewardsTabId = null;
  }
}

export { CompleteExploreOnBing };
