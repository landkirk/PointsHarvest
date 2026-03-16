// Opens each daily set tile's href URL in a background tab, dwells briefly, then closes.
// Tiles matching quiz/poll/test/puzzle keywords linger until the user signals completion.

import { lingerOnPage } from '../util/timing.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import type { DailySetDebug } from '../util/debug.js';
import * as lingerOnTab from '../steps/linger-on-tab.js';
import * as validateTile from '../steps/validate-tile.js';
import type { Tile } from '../steps/validate-tile.js';
import { run as fetchActivities } from '../steps/fetch-activities.js';

export type DailySetTile = Tile;

const USER_ACTION_RE = /\b(quiz|poll|test|puzzle)\b/i;

class CompleteDailySets extends OrchestratorBase {
  private lingerTabId:   number | null = null;
  private lingerResolve: (() => void) | null = null;

  async run(ctx: Context): Promise<void> {
    const { dailySets = [], dailySetDebug = null, loggedIn } = await fetchActivities(ctx);
    if (!loggedIn) { await ctx.dbg('warn', 'Daily sets: not logged in — skipping'); return; }

    const rewardsTabId = ctx.session.rewardsTabId!;
    this.openedTabIds.add(rewardsTabId);

    const debug = dailySetDebug as DailySetDebug | null;

    await ctx.setState({ dailySetDebug });
    await ctx.dbg('info', `Daily sets: ${debug?.actionable ?? 0} actionable (section ${debug?.sectionFound ? 'found' : 'not found'})`);

    try {
      if (dailySets.length === 0) {
        await ctx.dbg('info', 'No actionable daily set tiles — skipping');
        return;
      }

      await ctx.dbg('info', `Starting daily sets: ${dailySets.length} tile(s)`);

      for (let i = 0; i < dailySets.length; i++) {
        if (!ctx.session.isActivelyRunning || this.stopped) return;

        const { href, ariaLabel, biId } = dailySets[i];
        const label = (ariaLabel || biId || href || '').slice(0, 60);
        await ctx.dbg('info', `[Daily set ${i + 1}/${dailySets.length}] Opening: "${label}"`);

        let tab: chrome.tabs.Tab;
        try {
          tab = await this.openManagedTab(href, true);
        } catch {
          await ctx.dbg('warn', `Failed to open tab for daily set tile ${i + 1}`);
          continue;
        }
        await this.waitForTabLoad(tab.id!, 15000);

        if (!ctx.session.isActivelyRunning || this.stopped) {
          this.closeTab(tab.id!);
          return;
        }

        const tileText = ariaLabel || biId;
        if (USER_ACTION_RE.test(tileText ?? '')) {
          await ctx.dbg('info', 'User action required — waiting for completion');
          await lingerOnTab.run(ctx, tab.id!, {
            onResolve: r => { this.lingerResolve = r; },
            onTabId:   id => { this.lingerTabId = id; },
          });
          await validateTile.run(ctx, dailySets[i], rewardsTabId);
        } else {
          await lingerOnPage('daily set tile');
          this.closeTab(tab.id!);
          await validateTile.run(ctx, dailySets[i], rewardsTabId);
        }

        await ctx.dbg('success', `Daily set tile ${i + 1}/${dailySets.length} complete`);
        ctx.setHeaderMessage({ status: `Daily sets (${i + 1} / ${dailySets.length})`, completed: i + 1, total: dailySets.length });

        if (i < dailySets.length - 1) {
          if (!ctx.session.isActivelyRunning || this.stopped) return;
          await lingerOnPage('between daily set tiles');
        }
      }

      await ctx.dbg('success', 'All daily set tiles complete');
    } finally {
      this.closeTab(rewardsTabId);
      ctx.session.rewardsTabId = null;
    }
  }

  onTabRemoved(tabId: number): void {
    if (tabId === this.lingerTabId && this.lingerResolve) {
      const resolve = this.lingerResolve;
      this.lingerResolve = null;
      this.lingerTabId = null;
      this.openedTabIds.delete(tabId);
      resolve();
    }
  }

  onUserActionComplete(): void {
    if (this.lingerResolve) {
      const resolve = this.lingerResolve;
      this.lingerResolve = null;
      if (this.lingerTabId) {
        this.closeTab(this.lingerTabId);
        this.lingerTabId = null;
      }
      resolve();
    }
  }

  protected async _onStop(_ctx: Context): Promise<void> {
    if (this.lingerResolve) {
      this.lingerResolve();
      this.lingerResolve = null;
      this.lingerTabId = null;
    }
  }
}

export { CompleteDailySets };
