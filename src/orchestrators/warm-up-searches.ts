// Runs a short warm-up sequence of 3 searches before the main orchestrator chain.

import { WARMUP_SEARCH_QUERIES } from '../util/search-queries.js';
import { shuffleArray } from '../util/array.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { performSearch } from '../steps/perform-search.js';

const WARMUP_COUNT = 3;

class WarmUpSearches extends OrchestratorBase {
  readonly name = 'warm-up searches';

  async run(ctx: Context): Promise<void> {
    await ctx.dbg(DBG.INFO, 'Warm-up: starting');
    ctx.setHeaderMessage({ status: 'Warming up…' });

    const shuffled = shuffleArray(WARMUP_SEARCH_QUERIES);
    const queries = shuffled.slice(0, WARMUP_COUNT);
    await ctx.setState({ warmUpQueries: queries });

    for (let i = 0; i < WARMUP_COUNT; i++) {
      this.checkStopped();

      const query = queries[i];
      const tab = await this.openManagedTab('https://www.bing.com', true);
      await this.waitForTabLoad(tab.id!);
      this.checkStoppedOrCloseTab(tab.id!);

      await performSearch.run(ctx, tab.id!, query);
      this.closeTab(tab.id!);
      this.checkStopped();

      await ctx.dbg(DBG.INFO, `Warm-up: ${i + 1}/${WARMUP_COUNT}`);
    }

    await ctx.dbg(DBG.SUCCESS, 'Warm-up complete');
  }
}

export { WarmUpSearches };
