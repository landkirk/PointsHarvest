// Farms daily PC search points by running searches until the cap is reached.
// Must be called while the breakdown tab is still open (before closeRewardsTab).

import { PC_SEARCH_QUERIES } from '../util/config.js';
import { session, setState } from '../util/state.js';
import { dbg } from '../util/debug.js';
import { lingerOnPage } from '../util/timing.js';
import { waitForTabLoad } from '../util/tabs.js';
import { performSearchInTab } from './perform-search.js';
import { fetchSearchCounters } from './fetch-counters.js';

const MAX_NO_PROGRESS = 3;

function findPcCounter(counters) {
  return counters?.find(c => c.type.toLowerCase() === 'pc search');
}

export async function farmPcSearches() {
  const { searchCounters } = await fetchSearchCounters();
  const counter = findPcCounter(searchCounters);

  if (!counter) {
    await dbg('warn', 'farmPcSearches: PC Search counter not found, skipping');
    return;
  }

  if (counter.current >= counter.max) {
    await dbg('info', `PC Search already at cap (${counter.current}/${counter.max}), skipping`);
    return;
  }

  await setState({ status: `Farming PC searches (${counter.current}/${counter.max})` });
  await dbg('info', `Farming PC searches: ${counter.current}/${counter.max}`);

  let current = counter.current;
  let max = counter.max;
  let noProgressCount = 0;
  const shuffled = [...PC_SEARCH_QUERIES].sort(() => Math.random() - 0.5);
  let shuffleIndex = 0;

  while (current < max && session.isActivelyRunning) {
    if (shuffleIndex >= shuffled.length) {
      await dbg('error', 'farmPcSearches: exhausted all search queries before reaching cap');
      break;
    }
    const query = shuffled[shuffleIndex++];

    await dbg('info', `PC search: "${query}"`);

    const tab = await chrome.tabs.create({ url: 'https://www.bing.com', active: true }).catch(() => null);
    if (!tab) {
      await dbg('warn', 'farmPcSearches: failed to open tab');
      break;
    }

    session.openedTabIds.add(tab.id);
    await waitForTabLoad(tab.id, 30000);

    if (!session.isActivelyRunning) {
      chrome.tabs.remove(tab.id).catch(() => {});
      session.openedTabIds.delete(tab.id);
      return;
    }

    await performSearchInTab(tab.id, query);
    chrome.tabs.remove(tab.id).catch(() => {});
    session.openedTabIds.delete(tab.id);

    if (!session.isActivelyRunning) return;

    await lingerOnPage('after PC search');

    const { searchCounters: updated } = await fetchSearchCounters();
    const updatedCounter = findPcCounter(updated);
    const newCurrent = updatedCounter?.current ?? current;

    if (newCurrent > current) {
      await setState({ status: `Farming PC searches (${newCurrent}/${max})` });
      await dbg('success', `PC Search points: ${newCurrent}/${max}`);
      noProgressCount = 0;
    } else {
      noProgressCount++;
      await dbg('warn', `PC Search points did not increase (${noProgressCount}/${MAX_NO_PROGRESS})`);
      if (noProgressCount >= MAX_NO_PROGRESS) {
        throw new Error(`farmPcSearches: no progress after ${MAX_NO_PROGRESS} searches, aborting`);
      }
    }

    current = newCurrent;
    max = updatedCounter?.max ?? max;
  }

  if (current >= max) {
    await dbg('success', `PC Search cap reached (${current}/${max})`);
  }
}
