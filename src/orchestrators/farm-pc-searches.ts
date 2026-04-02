// Farms daily PC search points by running searches until the cap is reached.

import { REWARDS_BREAKDOWN_URL } from '../util/config.js';
import { PC_SEARCH_QUERIES } from '../util/search-queries.js';
import { shuffleArray } from '../util/array.js';
import { lingerOnPage, TIMING } from '../util/timing.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { PC_SEARCH_TYPE, PHASE } from '../util/state.js';
import type { SearchCounter } from '../util/state.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { performSearch } from '../steps/perform-search.js';
import { fetchCounters } from '../steps/fetch-counters.js';

const MAX_NO_PROGRESS = 3;

function findPcCounter(counters: SearchCounter[] | null | undefined): SearchCounter | undefined {
  return counters?.find((c) => c.type.toLowerCase() === PC_SEARCH_TYPE);
}

class FarmPcSearches extends OrchestratorBase {
  readonly name = 'PC search farming';

  async run(ctx: Context): Promise<void> {
    const tab = await this.openManagedTab(REWARDS_BREAKDOWN_URL, false);
    ctx.signal.throwIfAborted();
    await this._farm(ctx, tab.id);
  }

  private async _farm(ctx: Context, breakdownTabId: number): Promise<void> {
    ctx.signal.throwIfAborted();
    const searchCounters = await fetchCounters.run(ctx, breakdownTabId);
    if (searchCounters === null) return;
    const counter = findPcCounter(searchCounters);

    if (!counter) {
      await ctx.fail('counter', 'PC search counter not found — skipping');
      return;
    }

    if (counter.current >= counter.max) {
      await ctx.dbg(
        DBG.INFO,
        `PC Search already at cap (${counter.current}/${counter.max}), skipping`,
      );
      await ctx.updateHeader({
        headerMessage: `Farming PC searches (${counter.max} / ${counter.max})`,
        activePhase: PHASE.FARM,
        phaseProgress: { done: counter.max, total: counter.max },
        phasePoints: { farm: counter.currentPoints },
      });
      return;
    }

    await ctx.dbg(DBG.INFO, `PC farm started: ${counter.current}/${counter.max}`);

    let current = counter.current;
    let max = counter.max;

    await ctx.updateHeader({
      headerMessage: `Farming PC searches (${current} / ${max})`,
      activePhase: PHASE.FARM,
      phaseProgress: { done: current, total: max },
      phasePoints: { farm: counter.currentPoints },
    });
    let currentPoints = counter.currentPoints;
    let noProgressCount = 0;
    const shuffled = shuffleArray(PC_SEARCH_QUERIES);
    let shuffleIndex = 0;

    while (current < max) {
      ctx.signal.throwIfAborted();

      if (shuffleIndex >= shuffled.length) {
        await ctx.fail('search', 'PC search queries exhausted');
        break;
      }
      const query = shuffled[shuffleIndex++];

      const tab = await this.openTabAndWait('https://www.bing.com', true, 30000, ctx.signal);

      await performSearch.run(ctx, tab.id, query);
      this.closeTab(tab.id);
      ctx.signal.throwIfAborted();

      await lingerOnPage('after PC search', TIMING.DELAY_BETWEEN_FARMING_SEARCHES, ctx.signal);
      ctx.signal.throwIfAborted();

      const updated = await fetchCounters.run(ctx, breakdownTabId);
      if (updated === null) {
        await ctx.fail('counter', 'PC farm aborted: counter fetch failed');
        return;
      }
      const updatedCounter = findPcCounter(updated);
      const newCurrent = updatedCounter?.current ?? current;

      if (newCurrent > current) {
        currentPoints = updatedCounter?.currentPoints ?? currentPoints;
        await ctx.dbg(DBG.SUCCESS, `PC search: ${newCurrent}/${max}`);
        await ctx.updateHeader({
          headerMessage: `Farming PC searches (${newCurrent} / ${max})`,
          activePhase: PHASE.FARM,
          phaseProgress: { done: newCurrent, total: max },
          phasePoints: { farm: currentPoints },
        });
        noProgressCount = 0;
      } else {
        noProgressCount++;
        await ctx.dbg(DBG.WARN, `No progress ${noProgressCount}/${MAX_NO_PROGRESS}`);
        if (noProgressCount >= MAX_NO_PROGRESS) {
          await ctx.fail(
            'search',
            `PC farm aborted: no progress after ${MAX_NO_PROGRESS} searches`,
          );
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
