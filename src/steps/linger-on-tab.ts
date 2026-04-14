import { setHeaderState } from '../util/persistent-state.js';
import { sleep } from '../util/timing.js';
import type { Context } from '../util/context.js';

export interface LingerHandle {
  promise: Promise<void>;
  resolve: () => void;
  tabId: number;
}

// Waits for the user to complete a required action in the given tab.
// The promise resolves when the user either:
//   - clicks "Done" in the popup  (sends USER_ACTION_COMPLETE to background)
//   - closes the tab directly     (caught by chrome.tabs.onRemoved in background.js)
export function lingerOnTab(ctx: Context, tabId: number, timeoutMs: number): LingerHandle {
  let earlyResolve!: () => void;
  const earlyPromise = new Promise<void>((r) => {
    earlyResolve = r;
  });

  const promise = (async () => {
    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch {
      return; // tab already closed before we started waiting
    }
    await ctx.setState({ isLingering: true });
    await setHeaderState({ headerMessage: 'Action required — complete the activity in the tab' });
    await ctx.broadcastProgress();
    await Promise.race([earlyPromise, sleep(timeoutMs, ctx.signal)]);
    await ctx.setState({ isLingering: false });
  })();

  return { promise, resolve: earlyResolve, tabId };
}
