// Farms daily PC search points by running searches until the cap is reached.

import { PC_SEARCH_QUERIES } from '../util/search-queries.js';
import { shuffleArray } from '../util/array.js';
import { PC_SEARCH_TYPE, REWARDS_EARN_URL } from '../util/config.js';
import { urlKey } from '../util/url.js';
import { lingerOnPage, TIMING } from '../util/timing.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { loadRunState } from '../util/persistent-state.js';
import type { SearchCounter } from '../util/persistent-state.js';
import { PHASE } from '../util/phase.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { performSearch } from '../steps/perform-search.js';
import { fetchCounters } from '../steps/fetch-counters.js';
import { FAIL } from '../util/failures.js';

const MAX_NO_PROGRESS = 3;

function findPcCounter(counters: SearchCounter[] | null | undefined): SearchCounter | undefined {
  return counters?.find((c) => c.type === PC_SEARCH_TYPE);
}

/** The counter flyout only exists on /earn — origin alone is not enough. */
function onEarnPage(url: string): boolean {
  try {
    return urlKey(url) === urlKey(REWARDS_EARN_URL);
  } catch {
    return false;
  }
}

class FarmPcSearches extends OrchestratorBase {
  readonly name = 'PC search farming';

  async run(ctx: Context): Promise<void> {
    ctx.signal.throwIfAborted();
    const rewardsTabId = await this._ensureRewardsTab(ctx);
    if (rewardsTabId === null) return;
    await this._farm(ctx, rewardsTabId);
  }

  /**
   * Reuse the already-open rewards tab, parked on /earn — the "Points
   * breakdown" flyout that carries the search counter only exists there.
   *
   * That tab is opened once at run start and survives four phases, so the user
   * may well have closed it by now. Re-open rather than skip: this phase is
   * worth the whole daily search cap, and a counter read against a closed tab
   * is swallowed by fetch-counters, which would burn every poll before failing.
   */
  private async _ensureRewardsTab(ctx: Context): Promise<number | null> {
    const existing = (await loadRunState()).rewardsTabId;
    if (existing) {
      const tab = await chrome.tabs.get(existing).catch(() => null);
      // Alive is not enough: the tab survives four phases, so the user may have
      // navigated it anywhere — and the flyout toggle only renders on /earn, so
      // any other page (even on the rewards origin) reads nothing.
      if (tab && tab.url && onEarnPage(tab.url)) return existing;
      if (tab) {
        try {
          await this.tabs.navigateTab(existing, REWARDS_EARN_URL, ctx.signal);
          await ctx.dbg(DBG.INFO, 'Navigated rewards tab to /earn for the points flyout');
          return existing;
        } catch {
          ctx.signal.throwIfAborted(); // a Stop is not a broken tab — don't reopen
          // navigation failed (tab just closed?) — fall through and reopen
        }
      }
    }

    try {
      const tab = await this.tabs.openAndFocusTab(REWARDS_EARN_URL, ctx.signal);
      this.tabs.untrackTab(tab.id); // managed by _endRun; must not be closed by closeAll()
      await ctx.setState({ rewardsTabId: tab.id });
      await ctx.dbg(DBG.WARN, 'Rewards tab was gone — reopened it to read search counters');
      return tab.id;
    } catch {
      // A user Stop aborts the tab-load wait mid-reopen; that is not a broken
      // tab and must not be logged as one — rethrow so the run ends cleanly.
      ctx.signal.throwIfAborted();
      await ctx.fail(FAIL.SEARCH, 'Rewards tab not open — cannot farm PC searches');
      return null;
    }
  }

  private async _farm(ctx: Context, rewardsTabId: number): Promise<void> {
    ctx.signal.throwIfAborted();
    const searchCounters = await fetchCounters._run(ctx, rewardsTabId, this.tabs);
    if (searchCounters === null) return;
    const counter = findPcCounter(searchCounters);

    if (!counter) {
      await ctx.fail(FAIL.SEARCH, 'PC search counter not found — skipping');
      return;
    }

    const setFarmStatus = (current: number, max: number, points: number) =>
      ctx.setPhase({
        phase: PHASE.FARM,
        headerMessage: `Farming PC searches (${current} / ${max})`,
        progress: { done: current, total: max },
        points,
      });

    if (counter.current >= counter.max) {
      await ctx.dbg(
        DBG.INFO,
        `PC Search already at cap (${counter.current}/${counter.max}), skipping`,
      );
      await setFarmStatus(counter.max, counter.max, counter.currentPoints);
      return;
    }

    await ctx.dbg(DBG.INFO, `PC farm started: ${counter.current}/${counter.max}`);

    let current = counter.current;
    let max = counter.max;

    await setFarmStatus(current, max, counter.currentPoints);
    let currentPoints = counter.currentPoints;
    let noProgressCount = 0;
    const shuffled = shuffleArray(PC_SEARCH_QUERIES);
    let shuffleIndex = 0;

    while (current < max) {
      ctx.signal.throwIfAborted();

      if (shuffleIndex >= shuffled.length) {
        await ctx.fail(FAIL.SEARCH, 'PC search queries exhausted');
        break;
      }
      const query = shuffled[shuffleIndex++];

      const tab = await this.tabs.openAndFocusTab('https://www.bing.com', ctx.signal);

      await performSearch._run(ctx, tab.id, query);
      await this.tabs.closeTabWithChildren(tab.id);
      ctx.signal.throwIfAborted();

      await lingerOnPage('after PC search', TIMING.DELAY_BETWEEN_FARMING_SEARCHES, ctx.signal);
      ctx.signal.throwIfAborted();

      this.tabs.focusTab(rewardsTabId);
      const updated = await fetchCounters._run(ctx, rewardsTabId, this.tabs);
      if (updated === null) {
        await ctx.fail(FAIL.SEARCH, 'PC farm aborted: counter fetch failed');
        return;
      }
      const updatedCounter = findPcCounter(updated);
      const newCurrent = updatedCounter?.current ?? current;

      if (newCurrent > current) {
        currentPoints = updatedCounter?.currentPoints ?? currentPoints;
        await ctx.dbg(DBG.SUCCESS, `PC search: ${newCurrent}/${max}`);
        await setFarmStatus(newCurrent, max, currentPoints);
        noProgressCount = 0;
      } else {
        noProgressCount++;
        await ctx.dbg(DBG.WARN, `No progress ${noProgressCount}/${MAX_NO_PROGRESS}`);
        if (noProgressCount >= MAX_NO_PROGRESS) {
          await ctx.fail(
            FAIL.SEARCH,
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
