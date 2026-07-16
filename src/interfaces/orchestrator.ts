import { StoppedError } from './stoppable.js';
import type { Context } from '../util/context.js';
import { TabManager } from '../util/tab-manager.js';
import {
  waitForUserAction,
  popupBlockedAction,
  type UserActionConfig,
  type UserActionHandle,
} from '../steps/wait-for-user-action.js';
import { clearFailuresByCategory, FAIL } from '../util/failures.js';
import { lingerOnPage, TIMING } from '../util/timing.js';
import { DBG } from '../util/debug.js';
import type { SectionDescriptor } from '../util/activity-types.js';
import { urlKey } from '../util/url.js';

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

  // Ensure the rewards tab is on the page that hosts this phase's cards — the
  // site splits its sections across `/` and `/earn`. Idempotent: skips the
  // reload when already on the target path, then dwells for the SPA to render.
  private async ensureRewardsPage(
    ctx: Context,
    rewardsTabId: number,
    targetUrl: string,
  ): Promise<void> {
    // Keyed on origin + path: a tab that drifted off rewards.bing.com (a sign-in
    // redirect on session expiry) must not read as "already there", or every
    // later message goes to a tab with no rewards content script.
    const tab = await chrome.tabs.get(rewardsTabId).catch(() => null);
    const currentKey = tab?.url ? urlKey(tab.url) : null;
    if (currentKey !== null && currentKey === urlKey(targetUrl)) return;

    await ctx.dbg(DBG.INFO, `Navigating rewards tab to ${targetUrl}`);
    await this.tabs.navigateTab(rewardsTabId, targetUrl, ctx.signal);
    ctx.signal.throwIfAborted();
    await lingerOnPage('rewards page render', TIMING.LINGER_ON_PAGE, ctx.signal);
  }

  /**
   * The whole phase preamble: navigate the rewards tab to the page hosting this
   * section, then open the section — in that order, because a navigation
   * re-renders the page with every section collapsed. Returns false when the
   * section's cards can't be put in the DOM, which means every click in the
   * phase would fail — skip it.
   *
   * Deliberately per-phase and just-in-time rather than expanding everything up
   * front. Beyond the navigation issue, a react-aria DisclosureGroup defaults to
   * allowsMultipleExpanded: false — if the site ever groups these sections,
   * opening one closes the last.
   */
  protected async ensureSectionReady(
    ctx: Context,
    rewardsTabId: number,
    section: SectionDescriptor,
  ): Promise<boolean> {
    await this.ensureRewardsPage(ctx, rewardsTabId, section.url);
    return this.ensureSectionExpanded(ctx, rewardsTabId, section);
  }

  /**
   * Open this phase's section so its cards are clickable, or confirm it's
   * already open. Returns false when the section has no cards in the DOM.
   * Call via ensureSectionReady — expanding before navigating is always wrong.
   */
  private async ensureSectionExpanded(
    ctx: Context,
    rewardsTabId: number,
    section: SectionDescriptor,
  ): Promise<boolean> {
    const { ready, tiles, via } = await this.tabs.expandSection(ctx, rewardsTabId, section);
    if (!ready) {
      // One clear failure beats one per card: every card in the phase is about to
      // miss, each burning a retry and a linger, and they'd crowd out the rest of
      // the failure log.
      await ctx.fail(
        FAIL.TAB,
        `Could not open the "${section.label}" section — skipping its activities`,
      );
      return false;
    }
    await ctx.dbg(DBG.INFO, `Section "${section.label}" open — ${tiles} tiles in DOM (via ${via})`);
    return true;
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
