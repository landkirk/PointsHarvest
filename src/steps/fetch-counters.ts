// Polls the dedicated breakdown tab for search point counters.
// Polling runs in the background service worker (not the tab) to avoid
// Chrome's background-tab timer throttling.

import { sleep, TIMEOUTS, randMs, TIMING } from '../util/timing.js';
import { MSG_ACTION } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import { StepBase } from '../interfaces/step.js';
import type { Context } from '../util/context.js';
import type { SearchCounter } from '../util/persistent-state.js';
import { PC_SEARCH_POINTS_PER_SEARCH } from '../util/config.js';

const MAX_POLLS = TIMEOUTS.FETCH_COUNTERS_MAX_POLLS;

class FetchCountersStep extends StepBase<[number | null], SearchCounter[] | null> {
  readonly name = 'fetch-counters';

  async run(ctx: Context, breakdownTabId: number | null): Promise<SearchCounter[] | null> {
    if (!breakdownTabId) {
      await ctx.dbg(DBG.WARN, 'fetchSearchCounters: no breakdown tab open');
      return null;
    }

    for (let i = 0; i < MAX_POLLS; i++) {
      ctx.signal.throwIfAborted();
      const result = await chrome.tabs
        .sendMessage(breakdownTabId, { action: MSG_ACTION.GET_COUNTERS })
        .catch(() => null);

      if (result?.searchCounters?.length > 0) {
        const valid: SearchCounter[] = result.searchCounters
          .filter((c: SearchCounter) => !Number.isNaN(c.current) && !Number.isNaN(c.max))
          .map((c: SearchCounter) => ({
            type: c.type,
            current: Math.floor(c.current / PC_SEARCH_POINTS_PER_SEARCH),
            max: Math.floor(c.max / PC_SEARCH_POINTS_PER_SEARCH),
            currentPoints: c.current,
            maxPoints: c.max,
          }));
        if (valid.length < result.searchCounters.length) {
          await ctx.dbg(
            DBG.WARN,
            `Dropped ${result.searchCounters.length - valid.length} counter(s) with NaN values`,
          );
        }
        await ctx.setState({ searchCounters: valid });
        await ctx.dbg(
          DBG.INFO,
          `Search counters: ${valid.map((c) => `${c.type}: ${c.current}/${c.max}`).join(', ')}`,
        );
        return valid;
      }

      if (i < MAX_POLLS - 1) await sleep(randMs(...TIMING.FETCH_COUNTERS_POLL), ctx.signal);
    }

    await ctx.fail('counter', `Counter fetch timed out after ${MAX_POLLS}s`);
    return null;
  }
}

export const fetchCounters = new FetchCountersStep();
