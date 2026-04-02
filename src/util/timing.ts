import { dbg, DBG } from './debug.js';

// Named timing ranges — change here to affect all call sites.
export const TIMING: Record<string, [number, number]> = {
  LINGER_ON_PAGE: [3000, 5000], // dwell time on any page
  LINGER_ON_SEARCH: [1500, 3000], // dwell time on search tab
  DELAY_BETWEEN_FARMING_SEARCHES: [2000, 4000], // pause between PC farm searches
};

export const TIMEOUTS = {
  FETCH_ACTIVITIES: 20_000, // rewards page extraction timeout
  FETCH_COUNTERS_POLL: 1_000, // counter poll interval
  FETCH_COUNTERS_MAX_POLLS: 20, // max polls before giving up
  REWARDS_DOM_MAX_WAIT: 15_000, // max wait for DOM to render activities
  REWARDS_DOM_POLL: 500, // DOM poll interval
  VALIDATE_ACTIVITY: 2_000, // post-click settle delay
  TAB_LOAD: 30_000, // default waitForTabLoad timeout
};

/** Triangular distribution biased toward the middle of [min, max]. */
export function randMs(min: number, max: number): number {
  return Math.round(min + ((Math.random() + Math.random()) / 2) * (max - min));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(id);
      reject(signal!.reason);
    };
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Dwell on a page for a random duration and log it. */
export async function lingerOnPage(
  label = 'page',
  timing = TIMING.LINGER_ON_PAGE,
  signal?: AbortSignal,
): Promise<void> {
  const ms = randMs(...timing);
  await dbg(DBG.INFO, `Lingering on ${label} for ${(ms / 1000).toFixed(1)}s`);
  await sleep(ms, signal);
}
