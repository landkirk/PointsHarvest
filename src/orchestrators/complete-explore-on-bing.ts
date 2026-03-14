// Iterates through the mapped activity list, clicking each card on the rewards
// page and waiting for the resulting search tab to load and dwell.

import { waitForTabLoad } from '../util/tabs.js';
import { lingerOnPage, sleep } from '../util/timing.js';
import { MSG_ACTION } from '../util/config.js';
import type { Context } from '../util/context.js';
import type { MappedActivity } from './start-run.js';
import * as performSearch from '../steps/perform-search.js';
import * as validateTile from '../steps/validate-tile.js';

export async function run(ctx: Context, mapped: MappedActivity[], startIndex: number): Promise<void> {
  for (let i = startIndex; i < mapped.length; i++) {
    if (!ctx.session.isActivelyRunning) return;

    const { query, title } = mapped[i];

    if (!query) {
      await ctx.dbg('warn', `Skipping card ${i + 1} — no query could be generated for "${title}"`);
      continue;
    }

    const label = query.length > 40 ? query.slice(0, 40) + '…' : query;
    await ctx.setState({ status: `Searching: "${label}"` });
    await ctx.dbg('info', `[${i + 1}/${mapped.length}] Clicking card: "${title}"`);

    // Set up capture before sending click — tab may open before sendMessage resolves
    const captureTabPromise = new Promise<chrome.tabs.Tab>(resolve => { ctx.session.captureNextTabResolve = resolve; });

    const clickResult = await chrome.tabs.sendMessage(ctx.session.rewardsTabId!, { action: MSG_ACTION.CLICK_CARD, index: i })
      .catch((err: unknown) => { ctx.dbg('warn', `Card click message error for "${title}": ${(err as Error)?.message ?? err}`); return null; });

    if (!clickResult?.clicked) {
      ctx.session.captureNextTabResolve = null;
      await ctx.dbg('warn', `Card click failed for "${title}": ${clickResult?.error ?? 'no response'}`);
      continue;
    }

    let searchTab: chrome.tabs.Tab | null;
    try {
      searchTab = await Promise.race([captureTabPromise, sleep(10000).then(() => null)]);
    } finally {
      ctx.session.captureNextTabResolve = null;
    }

    if (!searchTab) {
      await ctx.dbg('warn', `No tab opened after clicking card "${title}"`);
      continue;
    }

    ctx.session.openedTabIds.add(searchTab.id!);
    chrome.tabs.update(searchTab.id!, { active: true }).catch(() => {});

    await waitForTabLoad(searchTab.id!, 30000);

    if (!ctx.session.isActivelyRunning) {
      chrome.tabs.remove(searchTab.id!).catch(() => {});
      return;
    }

    await performSearch.run(ctx, searchTab.id!, query);
    chrome.tabs.remove(searchTab.id!).catch(() => {});

    if (!ctx.session.isActivelyRunning) return;

    const completed = i + 1;
    await ctx.setState({
      currentIndex:      i,
      completedSearches: completed,
      lastLabel:         query,
      status:            `Running (${completed} / ${mapped.length})`,
    });
    await ctx.dbg('success', `Search ${completed}/${mapped.length} complete`);
    await validateTile.run(ctx, { href: mapped[i].href, ariaLabel: title });

    chrome.runtime.sendMessage({
      action:    MSG_ACTION.PROGRESS,
      completed,
      total:     mapped.length,
      label:     query,
    }).catch(() => {});

    if (i < mapped.length - 1) {
      await lingerOnPage('between searches');
      if (!ctx.session.isActivelyRunning) return;
    }
  }
}
