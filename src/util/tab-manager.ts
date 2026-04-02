import { openTab, closeOwnedTabs, type TabLoadState } from './tabs.js';
import { sleep, TIMEOUTS } from './timing.js';
import { MSG_ACTION } from './messaging.js';
import type { Context } from './context.js';

function abortable<T>(
  signal: AbortSignal | undefined,
  executor: (resolve: (value: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    let settled = false;
    const onAbort = () => {
      if (!settled) {
        settled = true;
        reject(signal!.reason);
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    executor((value) => {
      if (!settled) {
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      }
    });
  });
}

export class TabManager {
  private readonly openedTabIds = new Set<number>();
  private tabLoadState: TabLoadState = { pendingTabId: null, pendingResolve: null };
  private _captureResolve: ((tab: chrome.tabs.Tab | null) => void) | null = null;

  // ── Orchestrator API ────────────────────────────────────────────────────

  async openTabAndWait(
    url: string,
    active = true,
    timeoutMs = TIMEOUTS.TAB_LOAD,
    signal?: AbortSignal,
  ): Promise<chrome.tabs.Tab & { id: number }> {
    const tab = await this._openManagedTab(url, active);
    await this._waitForTabLoad(tab.id, timeoutMs, signal);
    return tab;
  }

  closeTab(tabId: number): void {
    chrome.tabs.remove(tabId).catch(() => {
      /* tab may already be closed */
    });
    this.openedTabIds.delete(tabId);
  }

  /** Stop tracking a tab without closing it (e.g. user closed it manually). */
  untrackTab(tabId: number): void {
    this.openedTabIds.delete(tabId);
  }

  async clickCardAndCaptureTab(
    ctx: Context,
    rewardsTabId: number,
    id: string,
    label: string,
  ): Promise<(chrome.tabs.Tab & { id: number }) | null> {
    const capturePromise = this._captureNextTab(10000, ctx.signal);

    const clickResult = await chrome.tabs
      .sendMessage(rewardsTabId, { action: MSG_ACTION.CLICK_CARD, id })
      .catch(async (err: unknown) => {
        await ctx.fail(
          'navigation',
          `Card click message error for "${label}": ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });

    if (!clickResult?.clicked) {
      this._captureResolve?.(null);
      await ctx.fail(
        'navigation',
        `Card click failed for "${label}": ${clickResult?.error ?? 'no response'}`,
      );
      return null;
    }

    const tab = await capturePromise;
    if (!tab) {
      await ctx.fail(
        'setup',
        `Chrome blocked the activity tab from opening ("${label}"). To fix: Chrome Settings → Privacy and security → Site settings → Pop-ups and redirects → Allow → rewards.bing.com`,
      );
      return null;
    }

    if (tab.id === undefined) throw new Error('Captured tab has no ID');
    this.openedTabIds.add(tab.id);

    await this._waitForTabLoad(tab.id, TIMEOUTS.TAB_LOAD, ctx.signal);

    return tab as chrome.tabs.Tab & { id: number };
  }

  // ── Internal / lifecycle ────────────────────────────────────────────────

  onTabUpdated(tabId: number, changeInfo: { status?: string }): void {
    const { pendingTabId, pendingResolve } = this.tabLoadState;
    if (changeInfo.status === 'complete' && tabId === pendingTabId && pendingResolve) {
      this.tabLoadState.pendingResolve = null;
      this.tabLoadState.pendingTabId = null;
      pendingResolve();
    }
  }

  onTabCreated(tab: chrome.tabs.Tab): void {
    if (this._captureResolve) {
      const resolve = this._captureResolve;
      this._captureResolve = null;
      resolve(tab);
    }
  }

  async closeAll(): Promise<void> {
    await closeOwnedTabs(this.openedTabIds);
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async _openManagedTab(
    url: string,
    active = false,
  ): Promise<chrome.tabs.Tab & { id: number }> {
    const tab = await openTab(url, active);
    if (tab.id === undefined) throw new Error('Opened tab has no ID');
    this.openedTabIds.add(tab.id);
    return tab as chrome.tabs.Tab & { id: number };
  }

  private async _waitForTabLoad(
    tabId: number,
    timeoutMs = TIMEOUTS.TAB_LOAD,
    signal?: AbortSignal,
  ): Promise<void> {
    this.tabLoadState.pendingTabId = tabId;
    try {
      await Promise.race([
        abortable<void>(signal, (resolve) => {
          this.tabLoadState.pendingResolve = resolve;
        }),
        sleep(timeoutMs, signal),
      ]);
    } finally {
      this.tabLoadState.pendingResolve = null;
      this.tabLoadState.pendingTabId = null;
    }
  }

  private async _captureNextTab(
    timeoutMs = 10000,
    signal?: AbortSignal,
  ): Promise<chrome.tabs.Tab | null> {
    const capturePromise = abortable<chrome.tabs.Tab | null>(signal, (resolve) => {
      this._captureResolve = resolve;
    });
    try {
      return await Promise.race([capturePromise, sleep(timeoutMs, signal).then(() => null)]);
    } finally {
      this._captureResolve = null;
    }
  }
}
