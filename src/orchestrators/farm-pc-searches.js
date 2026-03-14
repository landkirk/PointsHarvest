// Farms daily PC search points by running searches until the cap is reached.

import { REWARDS_BREAKDOWN_URL } from '../util/config.js';
import { PC_SEARCH_QUERIES } from '../util/search-queries.js';
import { lingerOnPage } from '../util/timing.js';
import { waitForTabLoad, openTab } from '../util/tabs.js';
import * as performSearch from '../steps/perform-search.js';
import * as fetchCounters from '../steps/fetch-counters.js';

const MAX_NO_PROGRESS = 3;

function findPcCounter(counters) {
  return counters?.find(c => c.type.toLowerCase() === 'pc search');
}

export async function run(ctx) {
  // Open a breakdown tab if one isn't already available
  const ownBreakdownTab = !ctx.session.breakdownTabId;
  if (ownBreakdownTab) {
    const tab = await openTab(ctx, REWARDS_BREAKDOWN_URL, false);
    ctx.session.breakdownTabId = tab.id;
  }

  try {
    await _farm(ctx);
  } finally {
    if (ownBreakdownTab && ctx.session.breakdownTabId) {
      chrome.tabs.remove(ctx.session.breakdownTabId).catch(() => {});
      ctx.session.openedTabIds.delete(ctx.session.breakdownTabId);
      ctx.session.breakdownTabId = null;
    }
  }
}

async function _farm(ctx) {
  const { searchCounters } = await fetchCounters.run(ctx);
  const counter = findPcCounter(searchCounters);

  if (!counter) {
    await ctx.dbg('warn', 'farmPcSearches: PC Search counter not found, skipping');
    return;
  }

  if (counter.current >= counter.max) {
    await ctx.dbg('info', `PC Search already at cap (${counter.current}/${counter.max}), skipping`);
    return;
  }

  await ctx.setState({ status: `Farming PC searches (${counter.current}/${counter.max})` });
  await ctx.dbg('info', `Farming PC searches: ${counter.current}/${counter.max}`);

  let current = counter.current;
  let max = counter.max;
  let noProgressCount = 0;
  const shuffled = [...PC_SEARCH_QUERIES].sort(() => Math.random() - 0.5);
  let shuffleIndex = 0;

  while (current < max && ctx.session.isActivelyRunning) {
    if (shuffleIndex >= shuffled.length) {
      await ctx.dbg('error', 'farmPcSearches: exhausted all search queries before reaching cap');
      break;
    }
    const query = shuffled[shuffleIndex++];

    await ctx.dbg('info', `PC search: "${query}"`);

    const tab = await openTab(ctx, 'https://www.bing.com', true);
    await waitForTabLoad(tab.id, 30000);

    if (!ctx.session.isActivelyRunning) {
      chrome.tabs.remove(tab.id).catch(() => {});
      ctx.session.openedTabIds.delete(tab.id);
      return;
    }

    await performSearch.run(ctx, tab.id, query);
    chrome.tabs.remove(tab.id).catch(() => {});
    ctx.session.openedTabIds.delete(tab.id);

    if (!ctx.session.isActivelyRunning) return;

    await lingerOnPage('after PC search');

    const { searchCounters: updated } = await fetchCounters.run(ctx);
    const updatedCounter = findPcCounter(updated);
    const newCurrent = updatedCounter?.current ?? current;

    if (newCurrent > current) {
      await ctx.setState({ status: `Farming PC searches (${newCurrent}/${max})` });
      await ctx.dbg('success', `PC Search points: ${newCurrent}/${max}`);
      noProgressCount = 0;
    } else {
      noProgressCount++;
      await ctx.dbg('warn', `PC Search points did not increase (${noProgressCount}/${MAX_NO_PROGRESS})`);
      if (noProgressCount >= MAX_NO_PROGRESS) {
        throw new Error(`farmPcSearches: no progress after ${MAX_NO_PROGRESS} searches, aborting`);
      }
    }

    current = newCurrent;
    max = updatedCounter?.max ?? max;
  }

  if (current >= max) {
    await ctx.dbg('success', `PC Search cap reached (${current}/${max})`);
  }
}
