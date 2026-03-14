// Iterates through the mapped activity list, clicking each card on the rewards
// page and waiting for the resulting search tab to load and dwell.

import { session, setState } from '../util/state.js';
import { closeRewardsTab, waitForTabLoad } from '../util/tabs.js';
import { dbg } from '../util/debug.js';
import { lingerOnPage, sleep } from '../util/timing.js';
import { MSG_ACTION } from '../util/config.js';
import { performSearchInTab } from './perform-search.js';
import { completeDailySets } from './complete-daily-sets.js';
import { fetchSearchCounters } from './fetch-counters.js';
import { farmPcSearches } from './farm-pc-searches.js';
import { validateTileComplete } from './validate-tile.js';

export async function runAllSearches(mapped, startIndex, dailySets = []) {
  for (let i = startIndex; i < mapped.length; i++) {
    if (!session.isActivelyRunning) return;

    const { query, title } = mapped[i];

    if (!query) {
      await dbg('warn', `Skipping card ${i + 1} — no query could be generated for "${title}"`);
      continue;
    }

    const label = query.length > 40 ? query.slice(0, 40) + '…' : query;
    await setState({ currentIndex: i, status: `Searching: "${label}"` });
    await dbg('info', `[${i + 1}/${mapped.length}] Clicking card: "${title}"`);

    // Set up capture before sending click — tab may open before sendMessage resolves
    const captureTabPromise = new Promise(resolve => { session.captureNextTabResolve = resolve; });

    const clickResult = await chrome.tabs.sendMessage(session.rewardsTabId, { action: MSG_ACTION.CLICK_CARD, index: i })
      .catch(() => null);

    if (!clickResult?.clicked) {
      session.captureNextTabResolve = null;
      await dbg('warn', `Card click failed for "${title}": ${clickResult?.error ?? 'no response'}`);
      continue;
    }

    const searchTab = await Promise.race([captureTabPromise, sleep(10000).then(() => null)]);
    session.captureNextTabResolve = null;

    if (!searchTab) {
      await dbg('warn', `No tab opened after clicking card "${title}"`);
      continue;
    }

    session.openedTabIds.add(searchTab.id);
    chrome.tabs.update(searchTab.id, { active: true }).catch(() => {});

    // Wait for the tab to finish loading
    await waitForTabLoad(searchTab.id, 30000);

    if (!session.isActivelyRunning) {
      chrome.tabs.remove(searchTab.id).catch(() => {});
      return;
    }

    await performSearchInTab(searchTab.id, query);
    chrome.tabs.remove(searchTab.id).catch(() => {});

    if (!session.isActivelyRunning) return;

    const completed = i + 1;
    await setState({
      completedSearches: completed,
      lastLabel: query,
      status: `Running (${completed} / ${mapped.length})`,
    });
    await dbg('success', `Search ${completed}/${mapped.length} complete`);
    await validateTileComplete(session.rewardsTabId, { href: mapped[i].href, ariaLabel: title });

    chrome.runtime.sendMessage({
      action: MSG_ACTION.PROGRESS,
      completed,
      total: mapped.length,
      label: query,
    }).catch(() => {});

    if (i < mapped.length - 1) {
      await lingerOnPage('between searches');
      if (!session.isActivelyRunning) return;
    }
  }

  // Complete daily set tiles before closing the rewards tab
  await completeDailySets(dailySets);

  try {
    await farmPcSearches();
  } catch (err) {
    await dbg('error', `PC search farming failed: ${err.message}`);
  }
  await fetchSearchCounters();
  closeRewardsTab();
  session.isActivelyRunning = false;
  await setState({ isRunning: false, status: 'Done for today!' });
  await dbg('success', 'All tasks complete');
  chrome.runtime.sendMessage({ action: MSG_ACTION.COMPLETE }).catch(() => {});
}
