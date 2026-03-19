// Opens each daily set activity's href URL in a background tab, dwells briefly, then closes.
// Activities matching quiz/poll/test/puzzle keywords linger until the user signals completion.

import { lingerOnPage } from '../util/timing.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { lingerOnTab } from '../steps/linger-on-tab.js';
import { validateActivity } from '../steps/validate-activity.js';
import { fetchActivities } from '../steps/fetch-activities.js';


const USER_ACTION_RE = /\b(quiz|poll|test|puzzle)\b/i;

class CompleteDailySets extends OrchestratorBase {
  readonly name = 'Daily sets';
  private lingerTabId:   number | null = null;
  private lingerResolve: (() => void) | null = null;

  async run(ctx: Context): Promise<void> {
    this.checkStopped();
    const { dailySets = [], loggedIn, rewardsTabId } = await fetchActivities.run(ctx);
    if (!loggedIn) { await ctx.dbg(DBG.WARN, 'Daily sets: not logged in — skipping'); return; }

    if (rewardsTabId) this.openedTabIds.add(rewardsTabId);

    try {
      if (dailySets.length === 0) {
        await ctx.dbg(DBG.INFO, 'No actionable daily set activities — skipping');
        return;
      }

      await ctx.dbg(DBG.INFO, `Starting daily sets: ${dailySets.length} activity/activities`);

      for (let i = 0; i < dailySets.length; i++) {
        this.checkStopped();

        const { href, title } = dailySets[i];
        const label = (title || href || '').slice(0, 60);
        await ctx.dbg(DBG.INFO, `[Daily set ${i + 1}/${dailySets.length}] Opening: "${label}"`);

        const attemptActivity = async (): Promise<boolean> => {
          const t = await this.openManagedTab(href, true);
          await this.waitForTabLoad(t.id!, 15000);
          this.checkStoppedOrCloseTab(t.id!);
          if (USER_ACTION_RE.test(title)) {
            await ctx.dbg(DBG.INFO, 'User action required — waiting for completion');
            await lingerOnTab.run(ctx, t.id!, {
              onResolve: r => { this.lingerResolve = r; },
              onTabId:   id => { this.lingerTabId = id; },
            });
          } else {
            await lingerOnPage('daily set activity');
            this.checkStoppedOrCloseTab(t.id!);
            this.closeTab(t.id!);
          }
          this.checkStopped();
          if (!rewardsTabId) return true;
          const validated = await validateActivity.run(ctx, dailySets[i], rewardsTabId);
          return validated !== false;
        };

        let succeeded: boolean;
        try {
          succeeded = await attemptActivity();
        } catch {
          await ctx.fail('navigation', `Failed to open tab for daily set activity ${i + 1}`);
          continue;
        }
        if (!succeeded) {
          await ctx.dbg(DBG.WARN, `Daily set activity ${i + 1} not validated — retrying`);
          await lingerOnPage('daily set activity retry');
          this.checkStopped();
          let retrySucceeded: boolean;
          try { retrySucceeded = await attemptActivity(); } catch {
            await ctx.fail('navigation', `Retry: failed to open tab for daily set activity ${i + 1}`);
            continue;
          }
          if (!retrySucceeded) {
            await ctx.fail('validation', `Daily set activity ${i + 1} still not validated after retry — skipping`);
          }
        }

        this.checkStopped();
        await ctx.dbg(DBG.SUCCESS, `Daily set activity ${i + 1}/${dailySets.length} complete`);
        ctx.setHeaderMessage({ status: `Daily sets (${i + 1} / ${dailySets.length})`, completedSearches: i + 1, totalSearches: dailySets.length });

        if (i < dailySets.length - 1) {
          await lingerOnPage('between daily set activities');
          this.checkStopped();
        }
      }

      await ctx.dbg(DBG.SUCCESS, 'All daily set activities complete');
    } finally {
      if (rewardsTabId) this.closeTab(rewardsTabId);
    }
  }

  private _resolveLinger(closeTab: boolean): void {
    if (!this.lingerResolve) return;
    const resolve = this.lingerResolve;
    this.lingerResolve = null;
    if (this.lingerTabId) {
      if (closeTab) this.closeTab(this.lingerTabId);
      else this.openedTabIds.delete(this.lingerTabId);
      this.lingerTabId = null;
    }
    resolve();
  }

  onTabRemoved(tabId: number): void {
    if (tabId === this.lingerTabId) this._resolveLinger(false);
  }

  onUserActionComplete(): void {
    this._resolveLinger(true);
  }

  protected async _onStop(_ctx: Context): Promise<void> {
    this._resolveLinger(true);
  }
}

export { CompleteDailySets };
