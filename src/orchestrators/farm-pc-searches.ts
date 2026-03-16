// Farms daily PC search points by running searches until the cap is reached.

import { REWARDS_BREAKDOWN_URL } from '../util/config.js';
import { PC_SEARCH_QUERIES } from '../util/search-queries.js';
import { lingerOnPage } from '../util/timing.js';
import { waitForTabLoad, openTab } from '../util/tabs.js';
import type { Context } from '../util/context.js';
import type { SearchCounter } from '../util/state.js';
import type { OrchestratorBase } from '../interfaces/orchestrator.js';
import * as performSearch from '../steps/perform-search.js';
import * as fetchCounters from '../steps/fetch-counters.js';

const MAX_NO_PROGRESS = 3;

function findPcCounter(counters: SearchCounter[] | undefined): SearchCounter | undefined {
  return counters?.find(c => c.type.toLowerCase() === 'pc search');
}

class FarmPcSearches implements OrchestratorBase {
  async run(ctx: Context): Promise<void> {
    const ownBreakdownTab = !ctx.session.breakdownTabId;
    if (ownBreakdownTab) {
      const tab = await openTab(ctx, REWARDS_BREAKDOWN_URL, false);
      ctx.session.breakdownTabId = tab.id!;
    }

    try {
      await this._farm(ctx);
    } finally {
      if (ownBreakdownTab && ctx.session.breakdownTabId) {
        chrome.tabs.remove(ctx.session.breakdownTabId).catch(() => {});
        ctx.session.breakdownTabId = null;
      }
    }
  }

  private async _farm(ctx: Context): Promise<void> {
    const { searchCounters } = await fetchCounters.run(ctx);
    const counter = findPcCounter(searchCounters);

    if (!counter) {
      await ctx.dbg('warn', 'farmPcSearches: PC Search counter not found, skipping');
      return;
    }

    if (counter.current >= counter.max) {
      await ctx.dbg('info', `PC Search already at cap (${counter.current}/${counter.max}), skipping`);
      return;
    }

    await ctx.setState({ status: `Farming PC searches (${counter.current}/${counter.max})` });
    await ctx.dbg('info', `PC farm started: ${counter.current}/${counter.max}`);

    ctx.setHeaderMessage({ status: 'Farming PC searches…' });

    let current = counter.current;
    let max = counter.max;
    let noProgressCount = 0;
    const shuffled = [...PC_SEARCH_QUERIES].sort(() => Math.random() - 0.5);
    let shuffleIndex = 0;

    while (current < max && ctx.session.isActivelyRunning) {
      if (shuffleIndex >= shuffled.length) {
        await ctx.dbg('error', 'PC farm aborted: queries exhausted');
        break;
      }
      const query = shuffled[shuffleIndex++];

      const tab = await openTab(ctx, 'https://www.bing.com', true);
      await waitForTabLoad(tab.id!, 30000);

      if (!ctx.session.isActivelyRunning) {
        chrome.tabs.remove(tab.id!).catch(() => {});
        return;
      }

      await performSearch.run(ctx, tab.id!, query);
      chrome.tabs.remove(tab.id!).catch(() => {});

      if (!ctx.session.isActivelyRunning) return;

      await lingerOnPage('after PC search');

      const { searchCounters: updated } = await fetchCounters.run(ctx);
      const updatedCounter = findPcCounter(updated);
      const newCurrent = updatedCounter?.current ?? current;

      if (newCurrent > current) {
        await ctx.setState({ status: `Farming PC searches (${newCurrent}/${max})` });
        await ctx.dbg('success', `PC search: ${newCurrent}/${max}`);
        ctx.setHeaderMessage({ status: 'Farming PC searches…', completed: newCurrent, total: max });
        noProgressCount = 0;
      } else {
        noProgressCount++;
        await ctx.dbg('warn', `No progress ${noProgressCount}/${MAX_NO_PROGRESS}`);
        if (noProgressCount >= MAX_NO_PROGRESS) {
          await ctx.dbg('error', `PC farm aborted: no progress after ${MAX_NO_PROGRESS} searches`);
          throw new Error(`farmPcSearches: no progress after ${MAX_NO_PROGRESS} searches, aborting`);
        }
      }

      current = newCurrent;
      max = updatedCounter?.max ?? max;
    }

    if (current >= max) {
      await ctx.dbg('success', `PC farm complete: ${current}/${max}`);
    }
  }
}

export { FarmPcSearches };
