import { dbg, DBG } from './debug.js';

// Named timing ranges — change here to affect all call sites.
// These are the base values at 1.0× multiplier (Normal speed).
export const TIMING: Record<string, [number, number]> = {
  LINGER_ON_PAGE: [6000, 10000], // dwell time on any page
  LINGER_ON_SEARCH: [3000, 6000], // dwell time on search tab
  DELAY_BETWEEN_FARMING_SEARCHES: [4000, 8000], // pause between PC farm searches
  FETCH_COUNTERS_POLL: [700, 1800], // jittered counter poll interval
  VALIDATE_ACTIVITY: [1400, 3800], // delay after clicking before validating activity completion
  CLICK_SIMULATION_MOVE_DELAY: [8, 25], // delay between pointer move events during click simulation
  CLICK_SIMULATION_HOLD_DOWN_DELAY: [60, 180], // delay between pointerdown and pointerup during click simulation
  CLICK_SIMULATION_RELEASE_DELAY: [10, 40], // delay after pointerup before click event
  CLICK_SIMULATION_SETTLE_DELAY: [30, 90], // pause on target before pressing (trusted CDP click only)
  RESULT_CLICK_HOVER: [500, 1500], // pause after scrollIntoView before dispatching click events
  RESULT_CLICK_DWELL: [2000, 6000], // additional page dwell after clicking a result
  RETRY_CLICK_PAUSE: [1500, 3500], // pause before re-clicking a card that opened no tab
};

export const TIMEOUTS = {
  FETCH_ACTIVITIES: 20_000, // rewards page extraction timeout
  FETCH_COUNTERS_MAX_POLLS: 20, // max polls before giving up
  // How long the content script keeps retrying the dashboard API before it
  // reports the session unreadable. Stays under FETCH_ACTIVITIES so the
  // background hears an answer rather than timing out on its own.
  REWARDS_EXTRACT_MAX_WAIT: 15_000,
  REWARDS_EXTRACT_POLL: 500, // API retry interval
  TAB_LOAD: 30_000, // default waitForTabLoad timeout
  // How long an off-rewards page gets to redirect back before it counts as a
  // sign-in redirect. Auth interstitials (login.live.com silent auth) finish
  // loading and THEN bounce back via JS — 'complete' alone proves nothing.
  AUTH_REDIRECT_GRACE: 5_000,
  TAB_CAPTURE: 10_000, // wait for a card-click to open a new tab
  // Capture window for re-clicks. The retry exists for a first click that landed
  // on an unpainted tile; a re-click that works opens its tab almost at once, so
  // waiting the full first-attempt window only slows the blocked-pop-up verdict.
  TAB_CAPTURE_RETRY: 3_000,
  EXPAND_SECTION_RENDER: 1_500, // how long a section gets to render its tiles after a click
  SECTION_CONFIRM_POLL: 250, // re-read a toggle's aria-expanded this often while confirming
  SECTION_TOGGLE_CLICK_ROUNDS: 2, // clicks tried before a section is reported unexpandable
  SHOW_MORE_CLICKS: 10, // max "Show more" pages to walk in one section
  SCROLL_SETTLE: 350, // wait after scrollIntoView before reading a tile's coordinates
  CARD_CLICK_ATTEMPTS: 3, // clicks tried before a card is reported as a blocked pop-up
  DEBUGGER_ATTACH_SETTLE: 600, // first CDP input after a fresh attach can be dropped; let it warm up
  USER_ACTION_POLL: 2 * 60_000, // 2 min — poll activity (single click)
  USER_ACTION_QUIZ: 10 * 60_000, // 10 min — quiz/test/puzzle activity
  PERMISSION_WAIT: 10 * 60_000, // max wait for user to fix Chrome popup permissions
};

// Speed multiplier — set once at run start via setTimingMultiplier().
// 1.0 = Normal (default), 0.6 = Fast, 4.0 = Slow, 8.0 = Stealth.
let _timingMultiplier = 1.0;
export function setTimingMultiplier(m: number): void {
  _timingMultiplier = m;
}

/** Long-tail human timing distribution: 80% normal triangular, 15% quick burst, 5% distracted pause. */
function _humanMs(min: number, max: number): number {
  const tri = (lo: number, hi: number) => lo + ((Math.random() + Math.random()) / 2) * (hi - lo);
  const p = Math.random();
  if (p < 0.8) return tri(min, max);
  if (p < 0.95) return tri(min * 0.3, min * 0.7);
  return tri(max, max * 2.0);
}

/** Long-tail human timing, scaled by the current speed multiplier. */
export function randMs(min: number, max: number): number {
  return Math.round(_humanMs(min, max) * _timingMultiplier);
}

/** Same long-tail distribution but ignores the speed multiplier — use for delays that should stay fixed regardless of speed setting. */
export function rawRandMs(min: number, max: number): number {
  return Math.round(_humanMs(min, max));
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
