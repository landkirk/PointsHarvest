import { setHeaderState } from '../util/persistent-state.js';
import { sleep, TIMEOUTS } from '../util/timing.js';
import { FAIL } from '../util/failures.js';
import type { FailureCategory } from '../util/failures.js';
import type { Context } from '../util/context.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface UserActionConfig {
  headerMessage: string;
  bannerTitle: string;
  bannerInstructions: string;
  actionButtonLabel: string;
  actionButtonUrl: string | null;
  failureCategory: FailureCategory;
  failureMessage: string;
  timeoutMs: number;
  theme: 'amber' | 'danger';
}

export interface UserActionHandle {
  promise: Promise<void>;
  resolve: () => void;
}

// ── Factory functions ──────────────────────────────────────────────────────

export function popupBlockedAction(label: string): UserActionConfig {
  return {
    headerMessage: `Chrome blocked "${label}" — allow pop-ups for rewards.bing.com, then click Done`,
    bannerTitle: 'Chrome is blocking activity tabs from opening.',
    bannerInstructions:
      'Fix: Chrome Settings → Privacy and security → Site settings → Pop-ups and redirects → Allow → rewards.bing.com',
    actionButtonLabel: 'Open Pop-up Settings',
    actionButtonUrl: 'chrome://settings/content/popups',
    failureCategory: FAIL.PERMISSION,
    failureMessage: `Chrome blocked the activity tab ("${label}"). To fix: Chrome Settings → Privacy and security → Site settings → Pop-ups and redirects → Allow → rewards.bing.com`,
    timeoutMs: TIMEOUTS.PERMISSION_WAIT,
    theme: 'amber',
  };
}

export function notLoggedInAction(): UserActionConfig {
  return {
    headerMessage:
      'Not signed in — sign into your Microsoft account on rewards.bing.com, then click Done',
    bannerTitle: 'Not signed in to Microsoft Rewards.',
    bannerInstructions:
      'Sign into your Microsoft account on rewards.bing.com, then click Done to retry.',
    actionButtonLabel: 'Open Bing Rewards',
    actionButtonUrl: 'https://rewards.bing.com',
    failureCategory: FAIL.AUTH,
    failureMessage: 'Not logged in — user prompted to sign in',
    timeoutMs: TIMEOUTS.PERMISSION_WAIT,
    theme: 'danger',
  };
}

// ── Core step ──────────────────────────────────────────────────────────────

/**
 * Pauses execution until the user completes a required action and clicks Done,
 * or the timeout expires. The promise resolves in either case.
 */
export function waitForUserAction(ctx: Context, config: UserActionConfig): UserActionHandle {
  let earlyResolve!: () => void;
  const earlyPromise = new Promise<void>((r) => {
    earlyResolve = r;
  });

  const promise = (async () => {
    await ctx.setState({ isLingering: true, activeUserAction: config });
    await setHeaderState({ headerMessage: config.headerMessage });
    await ctx.broadcastProgress();
    await Promise.race([earlyPromise, sleep(config.timeoutMs, ctx.signal)]);
    await ctx.setState({ isLingering: false, activeUserAction: null });
    await setHeaderState({ headerMessage: 'Resuming…' });
  })();

  return { promise, resolve: earlyResolve };
}
