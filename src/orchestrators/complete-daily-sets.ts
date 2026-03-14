// Opens each daily set tile's href URL in a background tab, dwells briefly, then closes.
// Tiles matching quiz/poll/test/puzzle keywords linger until the user signals completion.

import { waitForTabLoad, openTab } from '../util/tabs.js';
import { lingerOnPage } from '../util/timing.js';
import type { Context } from '../util/context.js';
import type { ActivitiesResult } from '../util/state.js';
import type { DailySetDebug } from '../util/debug.js';
import * as lingerOnTab from '../steps/linger-on-tab.js';
import * as validateTile from '../steps/validate-tile.js';
import type { Tile } from '../steps/validate-tile.js';

export type DailySetTile = Tile;

const USER_ACTION_RE = /\b(quiz|poll|test|puzzle)\b/i;

export async function run(ctx: Context, { dailySets = [], dailySetDebug = null }: Partial<ActivitiesResult> = {}): Promise<void> {
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
    if (!ctx.session.isActivelyRunning) return;

    const { href, ariaLabel, biId } = tiles[i];
    const label = (ariaLabel || biId || href || '').slice(0, 60);
    await ctx.dbg('info', `[Daily set ${i + 1}/${tiles.length}] Opening: "${label}"`);

    let tab: chrome.tabs.Tab;
    try {
      tab = await openTab(ctx, href, true);
    } catch {
      await ctx.dbg('warn', `Failed to open tab for daily set tile ${i + 1}`);
      continue;
    }

    await waitForTabLoad(tab.id!, 15000);

    if (!ctx.session.isActivelyRunning) {
      chrome.tabs.remove(tab.id!).catch(() => {});
      return;
    }

    const tileText = ariaLabel || biId;
    if (USER_ACTION_RE.test(tileText ?? '')) {
      await ctx.dbg('info', 'User action required — waiting for completion');
      await lingerOnTab.run(ctx, tab.id!);
      await validateTile.run(ctx, tiles[i]);
    } else {
      await lingerOnPage('daily set tile');
      chrome.tabs.remove(tab.id!).catch(() => {});
      await validateTile.run(ctx, tiles[i]);
    }
    await ctx.dbg('success', `Daily set tile ${i + 1}/${tiles.length} complete`);

    if (i < tiles.length - 1) {
      if (!ctx.session.isActivelyRunning) return;
      await lingerOnPage('between daily set tiles');
    }
  }

  await ctx.dbg('success', 'All daily set tiles complete');
}
