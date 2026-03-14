// Polls the dedicated breakdown tab for search point counters.
// Polling runs in the background service worker (not the tab) to avoid
// Chrome's background-tab timer throttling.

import { sleep } from '../util/timing.js';
import { MSG_ACTION } from '../util/config.js';
import type { Context } from '../util/context.js';
import type { SearchCounter } from '../util/state.js';

const POLL_INTERVAL_MS = 1000;
const MAX_POLLS        = 20;

interface CounterResult {
  searchCounters:     SearchCounter[];
  searchCounterDebug: unknown | null;
}

export async function run(ctx: Context): Promise<CounterResult> {
  if (!ctx.session.breakdownTabId) {
    await ctx.dbg('warn', 'fetchSearchCounters: no breakdown tab open');
    return { searchCounters: [], searchCounterDebug: null };
  }

  for (let i = 0; i < MAX_POLLS; i++) {
    const result = await chrome.tabs.sendMessage(ctx.session.breakdownTabId, { action: MSG_ACTION.GET_COUNTERS })
      .catch(() => null);

    if (result?.searchCounters?.length > 0) {
      const valid: SearchCounter[] = result.searchCounters.filter((c: SearchCounter) => !Number.isNaN(c.current) && !Number.isNaN(c.max));
      if (valid.length < result.searchCounters.length) {
        await ctx.dbg('warn', `Dropped ${result.searchCounters.length - valid.length} counter(s) with NaN values`);
      }
      const counters: CounterResult = { ...result, searchCounters: valid };
      await ctx.setState({ searchCounters: valid, searchCounterDebug: result.searchCounterDebug });
      await ctx.dbg('info', `Search counters: ${valid.map(c => `${c.type}: ${c.current}/${c.max}`).join(', ')}`);
      return counters;
    }

    if (i < MAX_POLLS - 1) await sleep(POLL_INTERVAL_MS);
  }

  await ctx.dbg('warn', `Counter fetch timed out after ${MAX_POLLS}s`);
  return { searchCounters: [], searchCounterDebug: null };
}
