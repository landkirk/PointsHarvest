import { StoppedError } from './stoppable.js';
import type { Context } from '../util/context.js';
import { TabManager } from '../util/tab-manager.js';
import { ActivityRunner } from '../util/activity-runner.js';

export { StoppedError };

export abstract class OrchestratorBase<TArgs extends unknown[] = []> {
  abstract readonly name: string;

  constructor(
    protected readonly tabs: TabManager = new TabManager(),
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

  protected async _onStop(_ctx: Context): Promise<void> {}

  onTabUpdated(tabId: number, changeInfo: { status?: string }): void {
    this.tabs.onTabUpdated(tabId, changeInfo);
  }

  onTabCreated(tab: chrome.tabs.Tab): void {
    this.tabs.onTabCreated(tab);
  }

  onTabRemoved(_tabId: number): void {}

  onUserActionComplete(): void {}
}
