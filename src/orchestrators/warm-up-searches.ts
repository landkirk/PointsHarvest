// Runs a short warm-up sequence of 3 searches before the main orchestrator chain.

import { WARMUP_SEARCH_QUERIES } from '../util/search-queries.js';
import { shuffleArray } from '../util/array.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { PHASE } from '../util/persistent-state.js';
import { performSearch } from '../steps/perform-search.js';

const WARMUP_COUNT = 3;

class WarmUpSearches extends OrchestratorBase {
  readonly name = 'warm-up searches';

  async run(ctx: Context): Promise<void> {
    await ctx.dbg(DBG.INFO, 'Warm-up: starting');
    await ctx.updateHeader({
      headerMessage: `Warming up (0 / ${WARMUP_COUNT})`,
      activePhase: PHASE.WARMUP,
      phaseProgress: { done: 0, total: WARMUP_COUNT },
      phasePoints: {},
    });

    const shuffled = shuffleArray(WARMUP_SEARCH_QUERIES);
    const queries = shuffled.slice(0, WARMUP_COUNT);
    await ctx.setState({ warmUpQueries: queries });

    for (let i = 0; i < WARMUP_COUNT; i++) {
      ctx.signal.throwIfAborted();

      const query = queries[i];
      const tab = await this.tabs.openTabAndWait('https://www.bing.com', ctx.signal, 30000);

      await performSearch.run(ctx, tab.id, query);
      this.tabs.closeTab(tab.id);
      ctx.signal.throwIfAborted();

      await ctx.dbg(DBG.INFO, `Warm-up: ${i + 1}/${WARMUP_COUNT}`);
      await ctx.updateHeader({
        headerMessage: `Warming up (${i + 1} / ${WARMUP_COUNT})`,
        activePhase: PHASE.WARMUP,
        phaseProgress: { done: i + 1, total: WARMUP_COUNT },
        phasePoints: {},
      });
    }

    await ctx.dbg(DBG.SUCCESS, 'Warm-up complete');
  }
}

export { WarmUpSearches };
