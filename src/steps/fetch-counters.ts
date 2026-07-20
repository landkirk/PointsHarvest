// Reads the PC search counter from the "Points breakdown" flyout on /earn:
// locate the "Today's points" toggle, open it with a trusted CDP click, have
// the content script parse the Bing-search row, then close the flyout again.
// Driven from the background service worker (not the tab) to avoid Chrome's
// background-tab timer throttling; the clicks ride the same trusted path as
// every card click, so nothing the extension dispatches is synthetic.

import { sleep, TIMEOUTS, randMs, TIMING } from '../util/timing.js';
import { CONTROL_KIND, MSG_ACTION } from '../util/messaging.js';
import type { CountersResponse } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import { StepBase } from '../interfaces/step.js';
import type { Context } from '../util/context.js';
import type { SearchCounter } from '../util/persistent-state.js';
import type { TabManager } from '../util/tab-manager.js';
import { PC_SEARCH_POINTS_PER_SEARCH } from '../util/config.js';
import { FAIL } from '../util/failures.js';

const MAX_POLLS = TIMEOUTS.FETCH_COUNTERS_MAX_POLLS;

class FetchCountersStep extends StepBase<[number | null, TabManager], SearchCounter[] | null> {
  readonly name = 'fetch-counters';

  async run(
    ctx: Context,
    rewardsTabId: number | null,
    tabs: TabManager,
  ): Promise<SearchCounter[] | null> {
    if (!rewardsTabId) {
      await ctx.dbg(DBG.WARN, 'fetchSearchCounters: no rewards tab open');
      return null;
    }

    for (let i = 0; i < MAX_POLLS; i++) {
      ctx.signal.throwIfAborted();
      const result = await this.readOnce(ctx, rewardsTabId, tabs);

      if (result?.read) {
        const valid: SearchCounter[] = result.searchCounters
          .filter((c) => !Number.isNaN(c.current) && !Number.isNaN(c.max))
          .map((c) => ({
            type: c.type,
            current: Math.floor(c.current / PC_SEARCH_POINTS_PER_SEARCH),
            max: Math.floor(c.max / PC_SEARCH_POINTS_PER_SEARCH),
            currentPoints: c.current,
            maxPoints: c.max,
          }));
        await ctx.setState({ searchCounters: valid });
        await ctx.dbg(
          DBG.INFO,
          `Search counters: ${valid.map((c) => `${c.type}: ${c.current}/${c.max}`).join(', ')}`,
        );
        return valid;
      }

      if (result?.detail) await ctx.dbg(DBG.WARN, `Counter read failed: ${result.detail}`);
      if (i < MAX_POLLS - 1) await sleep(randMs(...TIMING.FETCH_COUNTERS_POLL), ctx.signal);
    }

    await ctx.fail(FAIL.SEARCH, `Counter fetch timed out after ${MAX_POLLS} attempts`);
    return null;
  }

  /** One open → read → close round trip. Null when the content script is unreachable. */
  private async readOnce(
    ctx: Context,
    rewardsTabId: number,
    tabs: TabManager,
  ): Promise<CountersResponse | null> {
    const open = await tabs.clickPageControl(
      rewardsTabId,
      CONTROL_KIND.POINTS_TOGGLE,
      '"Today\'s points" toggle',
    );
    if (!open.ok) {
      return { read: false, searchCounters: [], detail: open.error ?? 'toggle click failed' };
    }

    const reply: unknown = await chrome.tabs
      .sendMessage(rewardsTabId, { action: MSG_ACTION.READ_COUNTERS })
      .catch(() => null);
    const result = (reply as CountersResponse | undefined) ?? null;

    // Best-effort close — a stuck-open flyout overlaps the tiles, but failing
    // to close it must not fail a read that already succeeded.
    const close = await tabs.clickPageControl(
      rewardsTabId,
      CONTROL_KIND.DIALOG_CLOSE,
      'points dialog Close',
    );
    if (!close.ok) {
      await ctx.dbg(DBG.WARN, close.error ?? 'Could not close the points dialog');
    }

    return result;
  }
}

export const fetchCounters = new FetchCountersStep();
