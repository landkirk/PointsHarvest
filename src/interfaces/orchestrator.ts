import { StoppedError } from './stoppable.js';
import type { Context } from '../util/context.js';
import { TabManager } from '../util/tab-manager.js';
import {
  waitForUserAction,
  popupBlockedAction,
  type UserActionConfig,
  type UserActionHandle,
} from '../steps/wait-for-user-action.js';
import { clearFailuresByCategory } from '../util/failures.js';

export { StoppedError };

export abstract class OrchestratorBase<TArgs extends unknown[] = []> {
  abstract readonly name: string;

  protected _currentUserActionWait: UserActionHandle | null = null;

  constructor(protected readonly tabs: TabManager) {}

  abstract run(ctx: Context, ...args: TArgs): Promise<void>;

  async stop(ctx: Context): Promise<void> {
    try {
      await this._onStop(ctx);
    } finally {
      await this.tabs.closeAll();
    }
  }

  protected async _onStop(_ctx: Context): Promise<void> {
    this._resolveUserActionWait();
  }

  // Records a failure, shows a banner, then pauses execution until the user
  // completes the required action and clicks Done (or Stop is pressed).
  protected async _waitForUserAction(ctx: Context, config: UserActionConfig): Promise<void> {
    await ctx.fail(config.failureCategory, config.failureMessage);
    const wait = waitForUserAction(ctx, config);
    this._currentUserActionWait = wait;
    await wait.promise;
    this._currentUserActionWait = null;
    await clearFailuresByCategory(config.failureCategory);
    await ctx.broadcastProgress();
  }

  // Convenience wrapper: pauses until the user fixes Chrome popup permissions.
  protected async _waitForPopupUnblock(ctx: Context, label: string): Promise<void> {
    return this._waitForUserAction(ctx, popupBlockedAction(label));
  }

  onTabUpdated(tabId: number, changeInfo: { status?: string }): void {
    this.tabs.onTabUpdated(tabId, changeInfo);
  }

  onTabCreated(tab: chrome.tabs.Tab): void {
    this.tabs.onTabCreated(tab);
  }

  onTabRemoved(_tabId: number): void {}

  onUserActionComplete(): void {
    this._resolveUserActionWait();
  }

  private _resolveUserActionWait(): void {
    this._currentUserActionWait?.resolve();
    this._currentUserActionWait = null;
  }
}
