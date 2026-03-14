import { dbg } from './debug.js';

// Named timing ranges — change here to affect all call sites.
export const TIMING: Record<string, [number, number]> = {
  INITIAL_DELAY:  [0,    8000],  // jitter before first search
  LINGER_ON_PAGE: [5000, 7000],  // dwell time on any page
};

/** Triangular distribution biased toward the middle of [min, max]. */
export function randMs(min: number, max: number): number {
  return Math.round(min + ((Math.random() + Math.random()) / 2) * (max - min));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Dwell on a page for a random 5–7s and log it. */
export async function lingerOnPage(label = 'page'): Promise<void> {
  const ms = randMs(...TIMING.LINGER_ON_PAGE);
  await dbg('info', `Lingering on ${label} for ${(ms / 1000).toFixed(1)}s`);
  await sleep(ms);
}
