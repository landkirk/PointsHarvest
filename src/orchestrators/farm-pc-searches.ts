// Farms daily PC search points by running searches until the cap is reached.

import { REWARDS_BREAKDOWN_URL, PC_SEARCH_POINTS_PER_SEARCH } from '../util/config.js';
import { PC_SEARCH_QUERIES } from '../util/search-queries.js';
import { shuffleArray } from '../util/array.js';
import { lingerOnPage, TIMING } from '../util/timing.js';
import { openTab } from '../util/tabs.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { PC_SEARCH_TYPE } from '../util/state.js';
import type { SearchCounter } from '../util/state.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { performSearch } from '../steps/perform-search.js';
import { fetchCounters } from '../steps/fetch-counters.js';

const MAX_NO_PROGRESS = 3;

function findPcCounter(counters: SearchCounter[] | null | undefined): SearchCounter | undefined {
  return counters?.find(c => c.type.toLowerCase() === PC_SEARCH_TYPE);
}

class FarmPcSearches extends OrchestratorBase {
  readonly name = 'PC search farming';
  private breakdownTabId: number | null = null;

  async run(ctx: Context): Promise<void> {
    const ownBreakdownTab = !this.breakdownTabId;
    if (ownBreakdownTab) {
      const tab = await openTab(REWARDS_BREAKDOWN_URL, false);
      this.breakdownTabId = tab.id!;
    }

    this.checkStopped();

    try {
      await this._farm(ctx);
    } finally {
      if (ownBreakdownTab && this.breakdownTabId) {
        chrome.tabs.remove(this.breakdownTabId).catch(() => {});
        this.breakdownTabId = null;
      }
    }
  }

  protected async _onStop(_ctx: Context): Promise<void> {
    if (this.breakdownTabId) {
      chrome.tabs.remove(this.breakdownTabId).catch(() => {});
      this.breakdownTabId = null;
    }
  }

  private async _farm(ctx: Context): Promise<void> {
    this.checkStopped();
    const searchCounters = await fetchCounters.run(ctx, this.breakdownTabId);
    if (searchCounters === null) return;
    const counter = findPcCounter(searchCounters);

    if (!counter) {
      await ctx.fail('counter', 'PC search counter not found — skipping');
      return;
    }

    if (counter.current >= counter.max) {
      await ctx.dbg(DBG.INFO, `PC Search already at cap (${counter.current}/${counter.max}), skipping`);
      return;
    }

    await ctx.dbg(DBG.INFO, `PC farm started: ${counter.current}/${counter.max}`);

    ctx.setHeaderMessage({ status: 'Farming PC searches…' });

    let current = counter.current;
    let max = counter.max;
    let noProgressCount = 0;
    const shuffled = shuffleArray(PC_SEARCH_QUERIES);
    let shuffleIndex = 0;

    while (current < max) {
      this.checkStopped();

      if (shuffleIndex >= shuffled.length) {
        await ctx.fail('search', 'PC search queries exhausted');
        break;
      }
      const query = shuffled[shuffleIndex++];

      const tab = await this.openTabAndWait('https://www.bing.com');

      await performSearch.run(ctx, tab.id!, query);
      this.closeTab(tab.id!);
      this.checkStopped();

      await lingerOnPage('after PC search', TIMING.DELAY_BETWEEN_FARMING_SEARCHES);
      this.checkStopped();

      const updated = await fetchCounters.run(ctx, this.breakdownTabId);
      if (updated === null) { await ctx.fail('counter', 'PC farm aborted: counter fetch failed'); return; }
      const updatedCounter = findPcCounter(updated);
      const newCurrent = updatedCounter?.current ?? current;

      if (newCurrent > current) {
        await ctx.dbg(DBG.SUCCESS, `PC search: ${newCurrent}/${max}`);
        ctx.setHeaderMessage({ status: 'Farming PC searches…', completedSearches: newCurrent / PC_SEARCH_POINTS_PER_SEARCH, totalSearches: max / PC_SEARCH_POINTS_PER_SEARCH });
        noProgressCount = 0;
      } else {
        noProgressCount++;
        await ctx.dbg(DBG.WARN, `No progress ${noProgressCount}/${MAX_NO_PROGRESS}`);
        if (noProgressCount >= MAX_NO_PROGRESS) {
          await ctx.fail('search', `PC farm aborted: no progress after ${MAX_NO_PROGRESS} searches`);
          return;
        }
      }

      current = newCurrent;
      max = updatedCounter?.max ?? max;
    }

    if (current >= max) {
      await ctx.dbg(DBG.SUCCESS, `PC farm complete: ${current}/${max}`);
    }
  }
}

export { FarmPcSearches };
