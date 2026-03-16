// Opens each daily set tile's href URL in a background tab, dwells briefly, then closes.
// Tiles matching quiz/poll/test/puzzle keywords linger until the user signals completion.

import { lingerOnPage } from '../util/timing.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import type { ActivitiesResult } from '../util/state.js';
import type { DailySetDebug } from '../util/debug.js';
import * as lingerOnTab from '../steps/linger-on-tab.js';
import * as validateTile from '../steps/validate-tile.js';
import type { Tile } from '../steps/validate-tile.js';

export type DailySetTile = Tile;

const USER_ACTION_RE = /\b(quiz|poll|test|puzzle)\b/i;

class CompleteDailySets extends OrchestratorBase<[Partial<ActivitiesResult>?]> {
  private lingerTabId:   number | null = null;
  private lingerResolve: (() => void) | null = null;

  async run(ctx: Context, { dailySets = [], dailySetDebug = null }: Partial<ActivitiesResult> = {}): Promise<void> {
    const tiles = dailySets;
    const debug = dailySetDebug as DailySetDebug | null;

    await ctx.setState({ dailySetDebug });
    await ctx.dbg('info', `Daily sets: ${debug?.actionable ?? 0} actionable (section ${debug?.sectionFound ? 'found' : 'not found'})`);

    if (tiles.length === 0) {
      await ctx.dbg('info', 'No actionable daily set tiles — skipping');
      return;
    }

    await ctx.dbg('info', `Starting daily sets: ${tiles.length} tile(s)`);

    for (let i = 0; i < tiles.length; i++) {
      if (!ctx.session.isActivelyRunning || this.stopped) return;

      const { href, ariaLabel, biId } = tiles[i];
      const label = (ariaLabel || biId || href || '').slice(0, 60);
      await ctx.dbg('info', `[Daily set ${i + 1}/${tiles.length}] Opening: "${label}"`);

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
        await validateTile.run(ctx, tiles[i]);
      } else {
        await lingerOnPage('daily set tile');
        this.closeTab(tab.id!);
        await validateTile.run(ctx, tiles[i]);
      }

      await ctx.dbg('success', `Daily set tile ${i + 1}/${tiles.length} complete`);
      ctx.setHeaderMessage({ status: `Daily sets (${i + 1} / ${tiles.length})`, completed: i + 1, total: tiles.length });

      if (i < tiles.length - 1) {
        if (!ctx.session.isActivelyRunning || this.stopped) return;
        await lingerOnPage('between daily set tiles');
      }
    }

    await ctx.dbg('success', 'All daily set tiles complete');
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
