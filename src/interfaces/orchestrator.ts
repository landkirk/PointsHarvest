import { StoppedError } from './stoppable.js';
import type { Context } from '../util/context.js';
import { TabManager } from '../util/tab-manager.js';
import { ActivityRunner } from '../util/activity-runner.js';
import { waitForPopupUnblock, type PermissionWaitHandle } from '../steps/wait-for-popup-unblock.js';

export { StoppedError };

export abstract class OrchestratorBase<TArgs extends unknown[] = []> {
  abstract readonly name: string;

  protected _currentPermissionWait: PermissionWaitHandle | null = null;

  constructor(
    protected readonly tabs: TabManager,
    protected readonly runner: ActivityRunner | null = null,
  ) {}

  abstract run(ctx: Context, ...args: TArgs): Promise<void>;

  async stop(ctx: Context): Promise<void> {
    try {
      await this._onStop(ctx);
    } finally {
      await this.tabs.closeAll();
    }
  }

  protected async _onStop(_ctx: Context): Promise<void> {
    this._currentPermissionWait?.resolve();
    this._currentPermissionWait = null;
  }

  // Records a ctx.fail, then pauses execution until the user fixes Chrome popup
  // permissions and clicks Done (or Stop is pressed).
  protected async _waitForPopupUnblock(ctx: Context, label: string): Promise<void> {
    await ctx.fail(
      'setup',
      `Chrome blocked the activity tab ("${label}"). To fix: Chrome Settings → Privacy and security → Site settings → Pop-ups and redirects → Allow → rewards.bing.com`,
    );
    const wait = waitForPopupUnblock(ctx, label);
    this._currentPermissionWait = wait;
    await wait.promise;
    this._currentPermissionWait = null;
  }

  onTabUpdated(tabId: number, changeInfo: { status?: string }): void {
    this.tabs.onTabUpdated(tabId, changeInfo);
  }

  onTabCreated(tab: chrome.tabs.Tab): void {
    this.tabs.onTabCreated(tab);
  }

  onTabRemoved(_tabId: number): void {}

  onUserActionComplete(): void {
    this._currentPermissionWait?.resolve();
    this._currentPermissionWait = null;
  }
}
