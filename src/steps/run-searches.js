// Iterates through the mapped activity list, clicking each card on the rewards
// page and waiting for the resulting search tab to load and dwell.

import { state, closeRewardsTab } from '../state.js';
import { dbg, randMs, sleep } from '../util/debug.js';
import { performSearchInTab } from './perform-search.js';

export async function runAllSearches(mapped, startIndex) {
  for (let i = startIndex; i < mapped.length; i++) {
    if (!state.isActivelyRunning) return;

    const { query, title } = mapped[i];

    if (!query) {
      await dbg('warn', `Skipping card ${i + 1} — no query could be generated for "${title}"`);
      continue;
    }

    const label = query.length > 40 ? query.slice(0, 40) + '…' : query;
    await chrome.storage.local.set({ currentIndex: i, status: `Searching: "${label}"` });
    await dbg('info', `[${i + 1}/${mapped.length}] Clicking card: "${title}"`);

    // Set up capture before sending click — tab may open before sendMessage resolves
    const captureTabPromise = new Promise(resolve => { state.captureNextTabResolve = resolve; });

    const clickResult = await chrome.tabs.sendMessage(state.rewardsTabId, { action: 'clickCard', index: i })
      .catch(() => null);

    if (!clickResult?.clicked) {
      state.captureNextTabResolve = null;
      await dbg('warn', `Card click failed for "${title}": ${clickResult?.error ?? 'no response'}`);
      continue;
    }

    const searchTab = await Promise.race([captureTabPromise, sleep(10000).then(() => null)]);
    state.captureNextTabResolve = null;

    if (!searchTab) {
      await dbg('warn', `No tab opened after clicking card "${title}"`);
      continue;
    }

    state.openedTabIds.add(searchTab.id);

    // Wait for the tab to finish loading
    state.pendingTabId = searchTab.id;
    await Promise.race([
      new Promise(resolve => { state.pendingResolve = resolve; }),
      sleep(30000),
    ]);
    state.pendingResolve = null;
    state.pendingTabId = null;

    if (!state.isActivelyRunning) {
      chrome.tabs.remove(searchTab.id).catch(() => {});
      return;
    }

    await performSearchInTab(searchTab.id, query);
    chrome.tabs.remove(searchTab.id).catch(() => {});

    if (!state.isActivelyRunning) return;

    const completed = i + 1;
    await chrome.storage.local.set({
      completedSearches: completed,
      lastLabel: query,
      status: `Running (${completed} / ${mapped.length})`,
    });
    await dbg('success', `Search ${completed}/${mapped.length} complete`);

    chrome.runtime.sendMessage({
      action: 'progress',
      completed,
      total: mapped.length,
      label: query,
    }).catch(() => {});

    if (i < mapped.length - 1) {
      const delay = randMs(1800, 5000);
      await dbg('info', `Next search in ${(delay / 1000).toFixed(1)}s`);
      await sleep(delay);
      if (!state.isActivelyRunning) return;
    }
  }

  // Close the rewards tab now that all cards have been clicked
  closeRewardsTab();

  state.isActivelyRunning = false;
  await chrome.storage.local.set({ isRunning: false, status: 'Done for today!' });
  await dbg('success', 'All searches complete');
  chrome.runtime.sendMessage({ action: 'complete' }).catch(() => {});
}
