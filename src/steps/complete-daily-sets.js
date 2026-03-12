// Opens each daily set tile's href URL in a background tab, dwells briefly, then closes.
// No search interaction is required — visiting the URL counts as completing the tile.

import { state, waitForTabLoad } from '../state.js';
import { dbg, randMs, sleep } from '../util/debug.js';

export async function completeDailySets(dailySets) {
  if (!dailySets || dailySets.length === 0) {
    await dbg('info', 'No actionable daily set tiles — skipping');
    return;
  }

  await dbg('info', `Starting daily sets: ${dailySets.length} tile(s)`);

  for (let i = 0; i < dailySets.length; i++) {
    if (!state.isActivelyRunning) return;

    const { href, ariaLabel, biId } = dailySets[i];
    const label = (ariaLabel || biId || href).slice(0, 60);
    await dbg('info', `[Daily set ${i + 1}/${dailySets.length}] Opening: "${label}"`);

    const tab = await chrome.tabs.create({ url: href, active: false }).catch(() => null);
    if (!tab) {
      await dbg('warn', `Failed to open tab for daily set tile ${i + 1}`);
      continue;
    }

    state.openedTabIds.add(tab.id);

    // Wait for tab to load (reuses same pendingTabId mechanism as search tabs)
    await waitForTabLoad(tab.id, 15000);

    if (!state.isActivelyRunning) {
      chrome.tabs.remove(tab.id).catch(() => {});
      return;
    }

    const dwell = randMs(1500, 4000);
    await dbg('info', `Dwell ${(dwell / 1000).toFixed(1)}s`);
    await sleep(dwell);

    chrome.tabs.remove(tab.id).catch(() => {});
    await dbg('success', `Daily set tile ${i + 1}/${dailySets.length} complete`);

    if (i < dailySets.length - 1) {
      if (!state.isActivelyRunning) return;
      const delay = randMs(1500, 4000);
      await dbg('info', `Next daily set tile in ${(delay / 1000).toFixed(1)}s`);
      await sleep(delay);
    }
  }

  await dbg('success', 'All daily set tiles complete');
}
