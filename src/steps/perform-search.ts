// Responsible for completing a search activity in a Bing tab opened by a card click.
// The tab is already loaded at https://www.bing.com/?form=... when this is called.

import { lingerOnPage, randMs, sleep, TIMING } from '../util/timing.js';
import { MSG_ACTION } from '../util/messaging.js';
import { StepBase } from '../interfaces/step.js';
import type { Context } from '../util/context.js';

const CTR_CLICK_CHANCE = 0.35; // Simulate organic CTR to avoid bot-detection patterns (users click results ~35% of the time)

class PerformSearchStep extends StepBase<[number, string]> {
  readonly name = 'perform-search';

  async run(ctx: Context, tabId: number, query: string): Promise<void> {
    await lingerOnPage('search tab', TIMING.LINGER_ON_SEARCH, ctx.signal, { scaled: false });
    ctx.signal.throwIfAborted();

    const result = await chrome.tabs
      .sendMessage(tabId, { action: MSG_ACTION.PERFORM_SEARCH, query })
      .catch(() => null);
    ctx.signal.throwIfAborted();

    if (!result?.ok) {
      await ctx.fail(
        'search',
        `Search input failed for "${query}": ${result?.error ?? 'no response'}`,
      );
    }

    await lingerOnPage(`results: "${query}"`, undefined, ctx.signal, {
      onStart: (ms) => scheduleScrolls(tabId, ms, ctx.signal),
    });

    // Occasionally click an organic result to simulate realistic CTR.
    // This is fire-and-forget; if the content script is unavailable or the DOM has changed,
    // the click silently fails and the dwell continues normally.
    if (Math.random() < CTR_CLICK_CHANCE) {
      ctx.signal.throwIfAborted();
      await chrome.tabs.sendMessage(tabId, { action: MSG_ACTION.CLICK_RESULT }).catch(() => {});
      await sleep(randMs(...TIMING.RESULT_CLICK_DWELL), ctx.signal);
    }
  }
}

const SCROLL = {
  COUNT_THRESHOLD: 0.5, // P(3 scrolls) vs P(2 scrolls)
  DOWN_MIN_PX: 300,
  DOWN_MAX_PX: 900,
  UP_SCROLL_CHANCE: 0.2,
  WINDOW_LO: 0.2, // earliest scroll as fraction of dwell
  WINDOW_HI: 0.8, // latest down-scroll as fraction of dwell
  UP_SCROLL_AT: 0.85, // up-scroll fires at this fraction of dwell
  UP_SCROLL_FRAC: 0.25, // up-scroll magnitude as fraction of total down
} as const;

/** Fire 2–3 incremental scroll events at random points during the dwell window.
 *  All sends are fire-and-forget; failures are silently ignored. */
function scheduleScrolls(tabId: number, durationMs: number, signal?: AbortSignal): void {
  if (signal?.aborted) return;

  const count = Math.random() < SCROLL.COUNT_THRESHOLD ? 2 : 3;
  const totalDown = Math.round(
    SCROLL.DOWN_MIN_PX + Math.random() * (SCROLL.DOWN_MAX_PX - SCROLL.DOWN_MIN_PX),
  );
  const addUpScroll = Math.random() < SCROLL.UP_SCROLL_CHANCE;

  const lo = durationMs * SCROLL.WINDOW_LO;
  const hi = durationMs * SCROLL.WINDOW_HI;
  const offsets = Array.from({ length: count }, () => lo + Math.random() * (hi - lo)).sort(
    (a, b) => a - b,
  );

  const y = Math.round(totalDown / count);
  const ids: ReturnType<typeof setTimeout>[] = [];

  const schedule = (delay: number, scrollY: number) =>
    ids.push(
      setTimeout(() => {
        if (signal?.aborted) return;
        chrome.tabs
          .sendMessage(tabId, { action: MSG_ACTION.SCROLL_PAGE, y: scrollY, behavior: 'smooth' })
          .catch(() => {});
      }, delay),
    );

  for (const delay of offsets) schedule(delay, y);
  if (addUpScroll)
    schedule(durationMs * SCROLL.UP_SCROLL_AT, -Math.round(totalDown * SCROLL.UP_SCROLL_FRAC));

  signal?.addEventListener(
    'abort',
    () => {
      ids.forEach(clearTimeout);
      ids.length = 0;
    },
    { once: true },
  );
}

export const performSearch = new PerformSearchStep();
