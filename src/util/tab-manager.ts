import { sleep, TIMEOUTS } from './timing.js';
import { MSG_ACTION } from './messaging.js';
import type { Context } from './context.js';

export type CapturedTab = chrome.tabs.Tab & { id: number };

export const enum TabCaptureStatus {
  Ok = 'ok',
  Blocked = 'blocked',
  Failed = 'failed',
}

export type TabCaptureResult =
  | { status: TabCaptureStatus.Ok; tab: CapturedTab }
  | { status: TabCaptureStatus.Blocked }
  | { status: TabCaptureStatus.Failed };

interface TabLoadState {
  pendingTabId: number | null;
  pendingResolve: (() => void) | null;
}

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
  private windowId!: number;

  setWindowId(id: number): void {
    this.windowId = id;
  }

  // ── Orchestrator API ────────────────────────────────────────────────────

  /** Open a new tab, track it, and return it. Throws if creation fails. */
  async openTab(url: string): Promise<chrome.tabs.Tab & { id: number }> {
    const tab = await chrome.tabs
      .create({ url, active: false, windowId: this.windowId })
      .catch(() => null);
    if (!tab) throw new Error(`Failed to open tab: ${url}`);
    if (tab.id === undefined) throw new Error('Opened tab has no ID');
    this.openedTabIds.add(tab.id);
    return tab as chrome.tabs.Tab & { id: number };
  }

  async openAndFocusTab(
    url: string,
    signal?: AbortSignal,
    timeoutMs = TIMEOUTS.TAB_LOAD,
  ): Promise<chrome.tabs.Tab & { id: number }> {
    const tab = await this.openTab(url);
    await this._waitForTabLoad(tab.id, timeoutMs, signal);
    this.focusTab(tab.id);
    return tab;
  }

  focusTab(tabId: number): void {
    chrome.tabs.update(tabId, { active: true }).catch(() => {
      /* tab may already be closed */
    });
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

  /** Check that a tab still exists; call ctx.fail and return false if it does not. */
  async assertTabExists(ctx: Context, tabId: number, phase: string): Promise<boolean> {
    const exists = await chrome.tabs.get(tabId).then(
      () => true,
      () => false,
    );
    if (!exists) {
      await ctx.fail('navigation', `Rewards tab no longer exists — cannot run ${phase}`);
      return false;
    }
    return true;
  }

  async clickCardAndCaptureTab(
    ctx: Context,
    rewardsTabId: number,
    id: string,
    label: string,
  ): Promise<TabCaptureResult> {
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
      return { status: TabCaptureStatus.Failed };
    }

    const tab = await capturePromise;
    if (!tab) {
      return { status: TabCaptureStatus.Blocked };
    }

    if (tab.id === undefined) throw new Error('Captured tab has no ID');
    this.openedTabIds.add(tab.id);

    await this._waitForTabLoad(tab.id, TIMEOUTS.TAB_LOAD, ctx.signal);
    this.focusTab(tab.id as number);

    return { status: TabCaptureStatus.Ok, tab: tab as CapturedTab };
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
    const ids = [...this.openedTabIds];
    this.openedTabIds.clear();
    if (ids.length) chrome.tabs.remove(ids).catch(() => {});
  }

  // ── Private ─────────────────────────────────────────────────────────────

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
