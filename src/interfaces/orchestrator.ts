import { waitForTabLoad, closeOwnedTabs, openTab, type TabLoadState } from '../util/tabs.js';
import { sleep, lingerOnPage } from '../util/timing.js';
import { StoppedError } from './stoppable.js';
import type { Context } from '../util/context.js';
import type { FailureCategory } from '../util/failures.js';
import { MSG_ACTION, type ProgressPayload } from '../util/messaging.js';
import { DBG } from '../util/debug.js';

export { StoppedError };

export abstract class OrchestratorBase<TArgs extends unknown[] = []> {
  abstract readonly name: string;
  protected openedTabIds = new Set<number>();
  protected tabLoadState: TabLoadState = { pendingTabId: null, pendingResolve: null };
  protected captureNextTabResolve: ((tab: chrome.tabs.Tab | null) => void) | null = null;

  abstract run(ctx: Context, ...args: TArgs): Promise<void>;

  /** Resolves pending tab load, runs subclass cleanup, and closes owned tabs. */
  async stop(ctx: Context): Promise<void> {
    if (this.tabLoadState.pendingResolve) {
      this.tabLoadState.pendingResolve();
      this.tabLoadState.pendingResolve = null;
      this.tabLoadState.pendingTabId = null;
    }
    if (this.captureNextTabResolve) {
      this.captureNextTabResolve(null);
      this.captureNextTabResolve = null;
    }
    await this._onStop(ctx);
    await closeOwnedTabs(this.openedTabIds);
  }

  /** Run an activity, validate the result, and handle logging, retry, and ctx.fail. */
  protected async executeActivityWithValidation(
    ctx: Context,
    activityFn: () => Promise<boolean | null>,
    retryFn: (() => Promise<boolean | null>) | null,
    opts: {
      retryLogMessage: string;
      lingerLabel: string;
      failCategory: FailureCategory;
      failMessage: string;
      noRetryFailMessage?: string;
      navFailMessage?: string;
      retryNavFailMessage?: string;
      retryHeaderPayload?: ProgressPayload;
    },
  ): Promise<boolean> {
    let result: boolean | null;
    try {
      result = await activityFn();
    } catch {
      if (opts.navFailMessage) await ctx.fail('navigation', opts.navFailMessage);
      return false;
    }

    if (result === true) return true;

    if (!retryFn) {
      await ctx.fail(opts.failCategory, opts.noRetryFailMessage ?? opts.failMessage);
      return false;
    }

    await ctx.dbg(DBG.WARN, opts.retryLogMessage);
    if (opts.retryHeaderPayload) await ctx.updateHeader(opts.retryHeaderPayload);

    try {
      await this.retryAfterLinger(
        ctx,
        opts.lingerLabel,
        retryFn,
        opts.failCategory,
        opts.failMessage,
      );
    } catch {
      if (opts.retryNavFailMessage) await ctx.fail('navigation', opts.retryNavFailMessage);
      return false;
    }

    return true;
  }

  /** Linger, check stopped, run retry fn, and ctx.fail if it returns non-true. */
  protected async retryAfterLinger(
    ctx: Context,
    lingerLabel: string,
    retry: () => Promise<boolean | null>,
    failCategory: FailureCategory,
    failMessage: string,
  ): Promise<void> {
    await lingerOnPage(lingerLabel, undefined, ctx.signal);
    ctx.signal.throwIfAborted();
    const result = await retry();
    if (result !== true) {
      await ctx.fail(failCategory, failMessage);
    }
  }

  /** Subclass-specific cleanup called by stop(). Override when needed. */

  protected async _onStop(_ctx: Context): Promise<void> {}

  onTabUpdated(tabId: number, changeInfo: { status?: string }): void {
    const { pendingTabId, pendingResolve } = this.tabLoadState;
    if (changeInfo.status === 'complete' && tabId === pendingTabId && pendingResolve) {
      this.tabLoadState.pendingResolve = null;
      pendingResolve();
    }
  }

  onTabCreated(tab: chrome.tabs.Tab): void {
    if (this.captureNextTabResolve) {
      const resolve = this.captureNextTabResolve;
      this.captureNextTabResolve = null;
      resolve(tab);
    }
  }

  onTabRemoved(_tabId: number): void {}

  onUserActionComplete(): void {}

  protected async assertRewardsTabExists(
    ctx: Context,
    rewardsTabId: number,
    phase: string,
  ): Promise<boolean> {
    const exists = await chrome.tabs.get(rewardsTabId).then(
      () => true,
      () => false,
    );
    if (!exists) {
      await ctx.fail('navigation', `Rewards tab no longer exists — cannot run ${phase}`);
      return false;
    }
    return true;
  }

  protected waitForTabLoad(tabId: number, timeoutMs = 30000, signal?: AbortSignal): Promise<void> {
    return waitForTabLoad(tabId, this.tabLoadState, timeoutMs, signal);
  }

  /** Open a tab, wait for it to load, and return it. */
  protected async openTabAndWait(
    url: string,
    active = true,
    timeoutMs = 30000,
    signal?: AbortSignal,
  ): Promise<chrome.tabs.Tab & { id: number }> {
    const tab = await this.openManagedTab(url, active);
    await this.waitForTabLoad(tab.id, timeoutMs, signal);
    return tab;
  }

  /** Open a tab, track it in openedTabIds, and return it. */
  protected async openManagedTab(
    url: string,
    active = false,
  ): Promise<chrome.tabs.Tab & { id: number }> {
    const tab = await openTab(url, active);
    if (tab.id === undefined) throw new Error('Opened tab has no ID');
    this.openedTabIds.add(tab.id);
    return tab as chrome.tabs.Tab & { id: number };
  }

  /** Close a tab and remove it from openedTabIds. */
  protected closeTab(tabId: number): void {
    chrome.tabs.remove(tabId).catch(() => {
      /* tab may already be closed */
    });
    this.openedTabIds.delete(tabId);
  }

  /** Close tabId and throw the abort reason if the signal is aborted; no-op otherwise. */
  protected closeTabAndThrowIfAborted(ctx: Context, tabId: number): void {
    if (ctx.signal.aborted) {
      this.closeTab(tabId);
      ctx.signal.throwIfAborted();
    }
  }

  protected async captureNextTab(
    timeoutMs = 10000,
    signal?: AbortSignal,
  ): Promise<chrome.tabs.Tab | null> {
    const capturePromise = new Promise<chrome.tabs.Tab | null>((resolve) => {
      this.captureNextTabResolve = resolve;
    });
    try {
      return await Promise.race([capturePromise, sleep(timeoutMs, signal).then(() => null)]);
    } finally {
      this.captureNextTabResolve = null;
    }
  }

  /** Click a card on the rewards page and capture the tab it opens. Returns null on any failure. */
  protected async clickCardAndCaptureTab(
    ctx: Context,
    rewardsTabId: number,
    id: string,
    label: string,
  ): Promise<(chrome.tabs.Tab & { id: number }) | null> {
    const captureTabPromise = this.captureNextTab(10000, ctx.signal);

    const msg = { action: MSG_ACTION.CLICK_CARD, id };

    const clickResult = await chrome.tabs
      .sendMessage(rewardsTabId, msg)
      .catch(async (err: unknown) => {
        await ctx.fail(
          'navigation',
          `Card click message error for "${label}": ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });

    if (!clickResult?.clicked) {
      this.captureNextTabResolve?.(null);
      await ctx.fail(
        'navigation',
        `Card click failed for "${label}": ${clickResult?.error ?? 'no response'}`,
      );
      return null;
    }

    const tab = await captureTabPromise;
    if (!tab) {
      await ctx.fail(
        'setup',
        `Chrome blocked the activity tab from opening ("${label}"). To fix: Chrome Settings → Privacy and security → Site settings → Pop-ups and redirects → Allow → rewards.bing.com`,
      );
      return null;
    }

    if (tab.id === undefined) throw new Error('Captured tab has no ID');
    this.openedTabIds.add(tab.id);
    return tab as chrome.tabs.Tab & { id: number };
  }
}
