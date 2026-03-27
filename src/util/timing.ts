import { dbg, DBG } from './debug.js';

// Named timing ranges — change here to affect all call sites.
export const TIMING: Record<string, [number, number]> = {
  LINGER_ON_PAGE: [3000, 5000], // dwell time on any page
  LINGER_ON_SEARCH: [1500, 3000], // dwell time on search tab
  DELAY_BETWEEN_FARMING_SEARCHES: [2000, 4000], // pause between PC farm searches
};

/** Triangular distribution biased toward the middle of [min, max]. */
export function randMs(min: number, max: number): number {
  return Math.round(min + ((Math.random() + Math.random()) / 2) * (max - min));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Dwell on a page for a random duration and log it. */
export async function lingerOnPage(label = 'page', timing = TIMING.LINGER_ON_PAGE): Promise<void> {
  const ms = randMs(...timing);
  await dbg(DBG.INFO, `Lingering on ${label} for ${(ms / 1000).toFixed(1)}s`);
  await sleep(ms);
}
