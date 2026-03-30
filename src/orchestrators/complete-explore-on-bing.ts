// Iterates through the mapped activity list, clicking each card on the rewards
// page and waiting for the resulting search tab to load and dwell.

import { lingerOnPage } from '../util/timing.js';
import { MSG_ACTION } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { PHASE } from '../util/state.js';

import { fetchActivities, NotLoggedInError } from '../steps/fetch-activities.js';
import { buildSearchList, findRetryQuery } from '../util/activity.js';
import type { MappedActivity } from '../util/activity.js';
import { performSearch } from '../steps/perform-search.js';
import { validateActivity, ValidationStatus } from '../steps/validate-activity.js';

class CompleteExploreOnBing extends OrchestratorBase<[number]> {
  readonly name = 'Explore on Bing';
  private rewardsTabId: number | null = null;

  async run(ctx: Context, startIndex: number): Promise<void> {
    this.checkStopped();
    const { activities, loggedIn, rewardsTabId, alreadyCompletedCount = 0 } = await fetchActivities.run(ctx);
    if (!loggedIn) throw new NotLoggedInError();

    this.rewardsTabId = rewardsTabId;
    if (rewardsTabId) this.openedTabIds.add(rewardsTabId);
    await ctx.dbg(
      DBG.INFO,
      `Found ${activities.length} actionable activit${activities.length === 1 ? 'y' : 'ies'}`,
    );

    const mapped = buildSearchList(activities);
    await ctx.setState({ mappedActivities: mapped });
    chrome.runtime.sendMessage({ action: MSG_ACTION.ACTIVITIES_MAPPED }).catch(() => {
      /* popup may be closed */
    });

    const unmapped = mapped.filter((m) => m.unmatched).length;
    await ctx.dbg(
      DBG.INFO,
      `Mapped ${mapped.length - unmapped}/${mapped.length} activit${mapped.length === 1 ? 'y' : 'ies'} (${unmapped} unmatched)`,
    );

    await ctx.setState({ currentIndex: startIndex });
    const phaseTotal = alreadyCompletedCount + mapped.length;
    ctx.updateHeader({ activePhase: PHASE.EXPLORE, phaseProgress: { done: alreadyCompletedCount + startIndex, total: phaseTotal } });

    try {
      for (let i = startIndex; i < mapped.length; i++) {
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
        ctx.updateHeader({ headerMessage: `Searching: "${label}"` });
        await ctx.dbg(DBG.INFO, `[${i + 1}/${mapped.length}] Clicking card: "${title}"`);

        const retryQuery = findRetryQuery(query);
        const succeeded = await this.executeActivityWithValidation(
          ctx,
          () => this.runSearchForActivity(ctx, mapped[i], i, query),
          retryQuery ? () => this.runSearchForActivity(ctx, mapped[i], i, retryQuery) : null,
          {
            retryLogMessage: `Validation failed — retrying with lookup query: "${retryQuery}"`,
            lingerLabel: 'explore on bing validation retry',
            failCategory: 'validation',
            failMessage: `Validation failed after retry for: "${query}"`,
            noRetryFailMessage: `Validation failed — no lookup query for: "${query}"`,
          },
        );
        if (!succeeded) continue;

        const completed = i + 1;
        await ctx.setState({ currentIndex: i });
        await ctx.dbg(DBG.SUCCESS, `Search ${completed}/${mapped.length} complete`);
        this.checkStopped();

        ctx.updateHeader({
          headerMessage: `Running (${alreadyCompletedCount + completed} / ${phaseTotal})`,
          activePhase: PHASE.EXPLORE,
          phaseProgress: { done: alreadyCompletedCount + completed, total: phaseTotal },
          lastSearchString: query,
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
    index: number,
    query: string,
  ): Promise<boolean | null> {
    const rewardsTabId = this.rewardsTabId;
    if (rewardsTabId === null) throw new Error('rewardsTabId not initialized');
    const searchTab = await this.clickCardAndCaptureTab(ctx, rewardsTabId, index, activity.title);
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
