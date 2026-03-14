// Opens each daily set tile's href URL in a background tab, dwells briefly, then closes.
// Tiles matching quiz/poll/test/puzzle keywords linger until the user signals completion.

import { session } from '../util/state.js';
import { waitForTabLoad } from '../util/tabs.js';
import { dbg } from '../util/debug.js';
import { lingerOnPage } from '../util/timing.js';
import { lingerOnTab } from './linger-on-tab.js';
import { validateTileComplete } from './validate-tile.js';

const USER_ACTION_RE = /\b(quiz|poll|test|puzzle)\b/i;

export async function completeDailySets(dailySets) {
  if (!dailySets || dailySets.length === 0) {
    await dbg('info', 'No actionable daily set tiles — skipping');
    return;
  }

  await dbg('info', `Starting daily sets: ${dailySets.length} tile(s)`);

  for (let i = 0; i < dailySets.length; i++) {
    if (!session.isActivelyRunning) return;

    const { href, ariaLabel, biId } = dailySets[i];
    const label = (ariaLabel || biId || href).slice(0, 60);
    await dbg('info', `[Daily set ${i + 1}/${dailySets.length}] Opening: "${label}"`);

    const tab = await chrome.tabs.create({ url: href, active: true }).catch(() => null);
    if (!tab) {
      await dbg('warn', `Failed to open tab for daily set tile ${i + 1}`);
      continue;
    }

    session.openedTabIds.add(tab.id);

    // Wait for tab to load
    await waitForTabLoad(tab.id, 15000);

    if (!session.isActivelyRunning) {
      chrome.tabs.remove(tab.id).catch(() => {});
      return;
    }

    const tileText = ariaLabel || biId;
    if (USER_ACTION_RE.test(tileText)) {
      await dbg('info', 'User action required — waiting for completion');
      await lingerOnTab(tab.id);
      await validateTileComplete(session.rewardsTabId, dailySets[i]);
    } else {
      await lingerOnPage('daily set tile');
      chrome.tabs.remove(tab.id).catch(() => {});
      await validateTileComplete(session.rewardsTabId, dailySets[i]);
    }
    await dbg('success', `Daily set tile ${i + 1}/${dailySets.length} complete`);

    if (i < dailySets.length - 1) {
      if (!session.isActivelyRunning) return;
      await lingerOnPage('between daily set tiles');
    }
  }

  await dbg('success', 'All daily set tiles complete');
}
