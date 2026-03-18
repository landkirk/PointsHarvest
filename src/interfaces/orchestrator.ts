import { waitForTabLoad, closeOwnedTabs, openTab, type TabLoadState } from '../util/tabs.js';
import { StoppableBase, StoppedError } from './stoppable.js';
import type { Context } from '../util/context.js';

export { StoppedError };

export abstract class OrchestratorBase<TArgs extends unknown[] = []> extends StoppableBase {
  abstract readonly name: string;
  protected openedTabIds = new Set<number>();
  protected tabLoadState: TabLoadState = { pendingTabId: null, pendingResolve: null };

  abstract run(ctx: Context, ...args: TArgs): Promise<void>;

  /** Closes tabId then throws StoppedError if stopped; no-op otherwise. */
  protected checkStoppedOrCloseTab(tabId: number): void {
    try { this.checkStopped(); } catch (e) { this.closeTab(tabId); throw e; }
  }

  /** Resolves pending tab load, runs subclass cleanup, and closes owned tabs. */
  async stop(ctx: Context): Promise<void> {
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
