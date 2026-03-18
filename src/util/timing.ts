import { dbg, DBG } from './debug.js';

// Named timing ranges — change here to affect all call sites.
export const TIMING: Record<string, [number, number]> = {
  INITIAL_DELAY:       [0,    8000],  // jitter before first search
  LINGER_ON_PAGE:      [5000, 7000],  // dwell time on any page
  LINGER_ON_SEARCH:    [1500, 3000],  // dwell time on search tab
};

/** Triangular distribution biased toward the middle of [min, max]. */
export function randMs(min: number, max: number): number {
  return Math.round(min + ((Math.random() + Math.random()) / 2) * (max - min));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Dwell on a page for a random duration and log it. */
export async function lingerOnPage(label = 'page', timing = TIMING.LINGER_ON_PAGE): Promise<void> {
  const ms = randMs(...timing);
  await dbg(DBG.INFO, `Lingering on ${label} for ${(ms / 1000).toFixed(1)}s`);
  await sleep(ms);
}
