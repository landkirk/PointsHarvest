import { waitForTabLoad, closeOwnedTabs, openTab, type TabLoadState } from '../util/tabs.js';
import { getIsActivelyRunning } from '../util/state.js';
import type { Context } from '../util/context.js';

export class StoppedError extends Error {
  constructor() { super('Run stopped'); }
}

export abstract class OrchestratorBase<TArgs extends unknown[] = []> {
  abstract readonly name: string;
  protected stopped = false;
  protected openedTabIds = new Set<number>();
  protected tabLoadState: TabLoadState = { pendingTabId: null, pendingResolve: null };

  abstract run(ctx: Context, ...args: TArgs): Promise<void>;

  /** Throws StoppedError if stop() has been called or the run is no longer active. */
  protected checkStopped(): void {
    if (this.stopped || !getIsActivelyRunning()) throw new StoppedError();
  }

  /** Closes tabId then throws StoppedError if stopped; no-op otherwise. */
  protected checkStoppedOrCloseTab(tabId: number): void {
    try { this.checkStopped(); } catch (e) { this.closeTab(tabId); throw e; }
  }

  /** Sets the stopped flag, resolves pending tab load, runs subclass cleanup, and closes owned tabs. */
  async stop(ctx: Context): Promise<void> {
    this.stopped = true;
    if (this.tabLoadState.pendingResolve) {
      this.tabLoadState.pendingResolve();
      this.tabLoadState.pendingResolve = null;
      this.tabLoadState.pendingTabId = null;
    }
    await this._onStop(ctx);
    await closeOwnedTabs(this.openedTabIds);
  }

  /** Subclass-specific cleanup called by stop(). Override when needed. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async _onStop(_ctx: Context): Promise<void> {}

  onTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo): void {
    const { pendingTabId, pendingResolve } = this.tabLoadState;
    if (changeInfo.status === 'complete' && tabId === pendingTabId && pendingResolve) {
      this.tabLoadState.pendingResolve = null;
      pendingResolve();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onTabCreated(_tab: chrome.tabs.Tab): void {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onTabRemoved(_tabId: number): void {}

  onUserActionComplete(): void {}

  protected waitForTabLoad(tabId: number, timeoutMs = 30000): Promise<void> {
    return waitForTabLoad(tabId, this.tabLoadState, timeoutMs);
  }

  /** Open a tab, track it in openedTabIds, and return it. */
  protected async openManagedTab(url: string, active = false): Promise<chrome.tabs.Tab> {
    const tab = await openTab(url, active);
    this.openedTabIds.add(tab.id!);
    return tab;
  }

  /** Close a tab and remove it from openedTabIds. */
  protected closeTab(tabId: number): void {
    chrome.tabs.remove(tabId).catch(() => {});
    this.openedTabIds.delete(tabId);
  }
}
