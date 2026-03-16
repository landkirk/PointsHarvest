// Iterates through the mapped activity list, clicking each card on the rewards
// page and waiting for the resulting search tab to load and dwell.

import { sleep, lingerOnPage } from '../util/timing.js';
import { MSG_ACTION } from '../util/messaging.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { run as fetchActivities, NotLoggedInError } from '../steps/fetch-activities.js';
import { buildSearchList } from '../util/activity.js';
import * as performSearch from '../steps/perform-search.js';
import * as validateActivity from '../steps/validate-activity.js';

class CompleteExploreOnBing extends OrchestratorBase<[number]> {
  private captureNextTabResolve: ((tab: chrome.tabs.Tab | null) => void) | null = null;
  private rewardsTabId: number | null = null;

  async run(ctx: Context, startIndex: number): Promise<void> {
    const { activities, domDebug, loggedIn } = await fetchActivities(ctx);
    if (!loggedIn) throw new NotLoggedInError();

    this.rewardsTabId = ctx.session.rewardsTabId!;
    this.openedTabIds.add(this.rewardsTabId);

    await ctx.setState({ extractedActivities: activities, domDebug });
    await ctx.dbg('info', `DOM scan: ${domDebug?.actionElementsFound ?? '?'} actionable, ${domDebug?.skippedLocked ?? 0} locked, ${domDebug?.skippedCompleted ?? 0} completed, ${domDebug?.skippedUnknown ?? 0} unknown (skipped)`);
    await ctx.dbg('info', `Found ${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}`);

    const mapped = buildSearchList(activities);
    await ctx.setState({ mappedActivities: mapped, searchQueue: mapped.filter(m => m.query).map(m => m.query as string) });
    chrome.runtime.sendMessage({ action: MSG_ACTION.ACTIVITIES_MAPPED }).catch(() => {});

    const unmapped = mapped.filter(m => m.unmatched).length;
    await ctx.dbg('info', `Mapped ${mapped.length - unmapped}/${mapped.length} activit${mapped.length === 1 ? 'y' : 'ies'} (${unmapped} unmatched)`);

    await ctx.setState({
      totalSearches:     mapped.length,
      currentIndex:      startIndex,
      completedSearches: startIndex,
      status:            `Running (0 / ${mapped.length})`,
    });

    const rewardsTabId = this.rewardsTabId!;

    try {
      for (let i = startIndex; i < mapped.length; i++) {
        if (!ctx.session.isActivelyRunning || this.stopped) return;

        const { query, title } = mapped[i];

        if (!query) {
          await ctx.dbg('warn', `Skipping card ${i + 1} — no query could be generated for "${title}"`);
          continue;
        }

        const label = query.length > 40 ? query.slice(0, 40) + '…' : query;
        await ctx.setState({ status: `Searching: "${label}"` });
        await ctx.dbg('info', `[${i + 1}/${mapped.length}] Clicking card: "${title}"`);

        // Set up capture before sending click — tab may open before sendMessage resolves
        const captureTabPromise = new Promise<chrome.tabs.Tab | null>(resolve => { this.captureNextTabResolve = resolve; });

        const clickResult = await chrome.tabs.sendMessage(this.rewardsTabId!, { action: MSG_ACTION.CLICK_CARD, index: i })
          .catch((err: unknown) => { ctx.dbg('warn', `Card click message error for "${title}": ${(err as Error)?.message ?? String(err)}`); return null; });

        if (!clickResult?.clicked) {
          this.captureNextTabResolve = null;
          await ctx.dbg('warn', `Card click failed for "${title}": ${clickResult?.error ?? 'no response'}`);
          continue;
        }

        let searchTab: chrome.tabs.Tab | null;
        try {
          searchTab = await Promise.race([captureTabPromise, sleep(10000).then(() => null)]);
        } finally {
          this.captureNextTabResolve = null;
        }

        if (!searchTab) {
          await ctx.dbg('warn', `No tab opened after clicking card "${title}"`);
          continue;
        }

        this.openedTabIds.add(searchTab.id!);
        chrome.tabs.update(searchTab.id!, { active: true }).catch(() => {});

        await this.waitForTabLoad(searchTab.id!, 30000);

        if (!ctx.session.isActivelyRunning || this.stopped) {
          this.closeTab(searchTab.id!);
          return;
        }

        await performSearch.run(ctx, searchTab.id!, query);
        this.closeTab(searchTab.id!);

        if (!ctx.session.isActivelyRunning || this.stopped) return;

        const completed = i + 1;
        await ctx.setState({
          currentIndex:      i,
          completedSearches: completed,
          lastLabel:         query,
          status:            `Running (${completed} / ${mapped.length})`,
        });
        await ctx.dbg('success', `Search ${completed}/${mapped.length} complete`);
        await validateActivity.run(ctx, mapped[i], rewardsTabId);

        ctx.setHeaderMessage({ status: `Running (${completed} / ${mapped.length})`, completed, total: mapped.length, label: query });

        if (i < mapped.length - 1) {
          await lingerOnPage('between searches');
          if (!ctx.session.isActivelyRunning || this.stopped) return;
        }
      }
    } finally {
      if (this.rewardsTabId) {
        this.closeTab(this.rewardsTabId);
        ctx.session.rewardsTabId = null;
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
