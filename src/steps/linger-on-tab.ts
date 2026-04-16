import { setHeaderState } from '../util/persistent-state.js';
import { sleep } from '../util/timing.js';
import { LABEL_MAX, truncate } from '../util/format.js';
import type { Activity } from '../util/activity-types.js';
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
export function lingerOnTab(ctx: Context, tabId: number, activity: Activity): LingerHandle {
  let earlyResolve!: () => void;
  const earlyPromise = new Promise<void>((r) => {
    earlyResolve = r;
  });

  const kind = activity.userActionKind ?? 'activity';
  const title = truncate(activity.title, LABEL_MAX);
  const headerMessage = `Complete the ${kind} "${title}" in the Bing tab, then click Done.`;

  const promise = (async () => {
    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch {
      return; // tab already closed before we started waiting
    }
    await ctx.setState({ isLingering: true });
    await setHeaderState({ headerMessage });
    await ctx.broadcastProgress();
    await Promise.race([earlyPromise, sleep(activity.userActionTimeoutMs, ctx.signal)]);
    await ctx.setState({ isLingering: false });
    await ctx.broadcastProgress();
  })();

  return { promise, resolve: earlyResolve, tabId };
}
