import { setHeaderState } from '../util/persistent-state.js';
import { sleep, TIMEOUTS } from '../util/timing.js';
import type { Context } from '../util/context.js';

export interface PermissionWaitHandle {
  promise: Promise<void>;
  resolve: () => void;
}

// Waits for the user to fix Chrome popup permissions after a tab was blocked.
// The promise resolves when the user either:
//   - clicks "Done" in the popup  (sends USER_ACTION_COMPLETE to background)
//   - exceeds the permission wait timeout
export function waitForPopupUnblock(ctx: Context, label: string): PermissionWaitHandle {
  let earlyResolve!: () => void;
  const earlyPromise = new Promise<void>((r) => {
    earlyResolve = r;
  });

  const promise = (async () => {
    await ctx.setState({ isLingering: true });
    await setHeaderState({
      headerMessage: `Chrome blocked "${label}" — allow pop-ups for rewards.bing.com, then click Done`,
    });
    await ctx.broadcastProgress();
    await Promise.race([earlyPromise, sleep(TIMEOUTS.PERMISSION_WAIT, ctx.signal)]);
    await ctx.setState({ isLingering: false });
    await setHeaderState({ headerMessage: 'Resuming…' });
    await ctx.broadcastProgress();
  })();

  return { promise, resolve: earlyResolve };
}
