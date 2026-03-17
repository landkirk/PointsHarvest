// Polls the dedicated breakdown tab for search point counters.
// Polling runs in the background service worker (not the tab) to avoid
// Chrome's background-tab timer throttling.

import { sleep } from '../util/timing.js';
import { MSG_ACTION } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import type { SearchCounter } from '../util/state.js';

const POLL_INTERVAL_MS = 1000;
const MAX_POLLS        = 20;

export async function run(ctx: Context, breakdownTabId: number | null): Promise<SearchCounter[]> {
  if (!breakdownTabId) {
    await ctx.dbg(DBG.WARN, 'fetchSearchCounters: no breakdown tab open');
    return [];
  }

  for (let i = 0; i < MAX_POLLS; i++) {
    const result = await chrome.tabs.sendMessage(breakdownTabId, { action: MSG_ACTION.GET_COUNTERS })
      .catch(() => null);

    if (result?.searchCounters?.length > 0) {
      const valid: SearchCounter[] = result.searchCounters.filter((c: SearchCounter) => !Number.isNaN(c.current) && !Number.isNaN(c.max));
      if (valid.length < result.searchCounters.length) {
        await ctx.dbg(DBG.WARN, `Dropped ${result.searchCounters.length - valid.length} counter(s) with NaN values`);
      }
      await ctx.setState({ searchCounters: valid });
      await ctx.dbg(DBG.INFO, `Search counters: ${valid.map(c => `${c.type}: ${c.current}/${c.max}`).join(', ')}`);
      return valid;
    }

    if (i < MAX_POLLS - 1) await sleep(POLL_INTERVAL_MS);
  }

  await ctx.dbg(DBG.WARN, `Counter fetch timed out after ${MAX_POLLS}s`);
  return [];
}
