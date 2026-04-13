import { dbg, DBG } from './debug.js';

// Named timing ranges — change here to affect all call sites.
// These are the base values at 1.0× multiplier (Normal speed).
export const TIMING: Record<string, [number, number]> = {
  LINGER_ON_PAGE: [6000, 10000], // dwell time on any page
  LINGER_ON_SEARCH: [3000, 6000], // dwell time on search tab
  DELAY_BETWEEN_FARMING_SEARCHES: [4000, 8000], // pause between PC farm searches
};

export const TIMEOUTS = {
  FETCH_ACTIVITIES: 20_000, // rewards page extraction timeout
  FETCH_COUNTERS_POLL: 1_000, // counter poll interval
  FETCH_COUNTERS_MAX_POLLS: 20, // max polls before giving up
  REWARDS_DOM_MAX_WAIT: 15_000, // max wait for DOM to render activities
  REWARDS_DOM_POLL: 500, // DOM poll interval
  VALIDATE_ACTIVITY: 2_000, // post-click settle delay
  TAB_LOAD: 30_000, // default waitForTabLoad timeout
  PERMISSION_WAIT: 10 * 60_000, // max wait for user to fix Chrome popup permissions
};

// Speed multiplier — set once at run start via setTimingMultiplier().
// 1.0 = Normal (default), 0.6 = Fast, 4.0 = Slow, 8.0 = Stealth.
let _timingMultiplier = 1.0;
export function setTimingMultiplier(m: number): void {
  _timingMultiplier = m;
}

/** Triangular distribution biased toward the middle of [min, max], scaled by the current speed multiplier. */
export function randMs(min: number, max: number): number {
  const raw = min + ((Math.random() + Math.random()) / 2) * (max - min);
  return Math.round(raw * _timingMultiplier);
}

/** Same as randMs but ignores the speed multiplier — use for delays that should stay fixed regardless of speed setting. */
function rawRandMs(min: number, max: number): number {
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

/** Dwell on a page for a random duration and log it.
 *  `scaled: false` ignores the speed multiplier for this linger.
 *  `onStart(ms)` is called with the computed duration after logging, before sleeping. */
export async function lingerOnPage(
  label = 'page',
  timing = TIMING.LINGER_ON_PAGE,
  signal?: AbortSignal,
  { scaled = true, onStart }: { scaled?: boolean; onStart?: (ms: number) => void } = {},
): Promise<void> {
  const ms = scaled ? randMs(...timing) : rawRandMs(...timing);
  await dbg(DBG.INFO, `Lingering on ${label} for ${(ms / 1000).toFixed(1)}s`);
  onStart?.(ms);
  await sleep(ms, signal);
}
