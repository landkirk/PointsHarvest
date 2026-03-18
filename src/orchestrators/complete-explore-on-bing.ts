// Iterates through the mapped activity list, clicking each card on the rewards
// page and waiting for the resulting search tab to load and dwell.

import { sleep, lingerOnPage } from '../util/timing.js';
import { MSG_ACTION } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { setHeaderState } from '../util/state.js';
import { fetchActivities, NotLoggedInError } from '../steps/fetch-activities.js';
import { buildSearchList } from '../util/activity.js';
import { performSearch } from '../steps/perform-search.js';
import { validateActivity } from '../steps/validate-activity.js';

class CompleteExploreOnBing extends OrchestratorBase<[number]> {
  readonly name = 'Explore on Bing';
  private captureNextTabResolve: ((tab: chrome.tabs.Tab | null) => void) | null = null;
  private rewardsTabId: number | null = null;

  async run(ctx: Context, startIndex: number): Promise<void> {
    this.checkStopped();
    const { activities, loggedIn, rewardsTabId } = await fetchActivities.run(ctx);
    if (!loggedIn) throw new NotLoggedInError();

    this.rewardsTabId = rewardsTabId;
    if (rewardsTabId) this.openedTabIds.add(rewardsTabId);
    await ctx.dbg(DBG.INFO, `Found ${activities.length} actionable activit${activities.length === 1 ? 'y' : 'ies'}`);

    const mapped = buildSearchList(activities);
    await ctx.setState({ mappedActivities: mapped });
    chrome.runtime.sendMessage({ action: MSG_ACTION.ACTIVITIES_MAPPED }).catch(() => {});

    const unmapped = mapped.filter(m => m.unmatched).length;
    await ctx.dbg(DBG.INFO, `Mapped ${mapped.length - unmapped}/${mapped.length} activit${mapped.length === 1 ? 'y' : 'ies'} (${unmapped} unmatched)`);

    await ctx.setState({ currentIndex: startIndex });
    await setHeaderState({ totalSearches: mapped.length, completedSearches: startIndex });

    try {
      for (let i = startIndex; i < mapped.length; i++) {
        this.checkStopped();

        const { query, title } = mapped[i];

        if (!query) {
          await ctx.dbg(DBG.WARN, `Skipping card ${i + 1} — no query could be generated for "${title}"`);
          continue;
        }

        const label = query.length > 40 ? query.slice(0, 40) + '…' : query;
        ctx.setHeaderMessage({ status: `Searching: "${label}"` });
        await ctx.dbg(DBG.INFO, `[${i + 1}/${mapped.length}] Clicking card: "${title}"`);

        // Set up capture before sending click — tab may open before sendMessage resolves
        const captureTabPromise = new Promise<chrome.tabs.Tab | null>(resolve => { this.captureNextTabResolve = resolve; });

        const clickResult = await chrome.tabs.sendMessage(this.rewardsTabId!, { action: MSG_ACTION.CLICK_CARD, index: i })
          .catch((err: unknown) => { ctx.dbg(DBG.WARN, `Card click message error for "${title}": ${(err as Error)?.message ?? String(err)}`); return null; });

        if (!clickResult?.clicked) {
          this.captureNextTabResolve = null;
          await ctx.dbg(DBG.WARN, `Card click failed for "${title}": ${clickResult?.error ?? 'no response'}`);
          continue;
        }

        let searchTab: chrome.tabs.Tab | null;
        try {
          searchTab = await Promise.race([captureTabPromise, sleep(10000).then(() => null)]);
        } finally {
          this.captureNextTabResolve = null;
        }

        if (!searchTab) {
          await ctx.dbg(DBG.WARN, `No tab opened after clicking card "${title}"`);
          continue;
        }

        this.openedTabIds.add(searchTab.id!);
        chrome.tabs.update(searchTab.id!, { active: true }).catch(() => {});

        await this.waitForTabLoad(searchTab.id!, 30000);
        this.checkStoppedOrCloseTab(searchTab.id!);

        await performSearch.run(ctx, searchTab.id!, query);
        this.closeTab(searchTab.id!);
        this.checkStopped();

        const completed = i + 1;
        await ctx.setState({ currentIndex: i });
        await ctx.dbg(DBG.SUCCESS, `Search ${completed}/${mapped.length} complete`);
        this.checkStopped();
        await validateActivity.run(ctx, mapped[i], rewardsTabId!);

        ctx.setHeaderMessage({ status: `Running (${completed} / ${mapped.length})`, completedSearches: completed, totalSearches: mapped.length, lastSearchString: query });

        if (i < mapped.length - 1) {
          await lingerOnPage('between searches');
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

  onTabCreated(tab: chrome.tabs.Tab): void {
    if (this.captureNextTabResolve && tab.id !== this.rewardsTabId) {
      const resolve = this.captureNextTabResolve;
      this.captureNextTabResolve = null;
      resolve(tab);
    }
  }

  protected async _onStop(_ctx: Context): Promise<void> {
    if (this.captureNextTabResolve) {
      this.captureNextTabResolve(null);
      this.captureNextTabResolve = null;
    }
    this.rewardsTabId = null;
  }
}

export { CompleteExploreOnBing };
