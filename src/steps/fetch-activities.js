// Opens the rewards dashboard, waits for the content script to extract activity
// cards, and maps each activity to a usable search query.

import { closeRewardsTab } from '../util/tabs.js';
import { REWARDS_URL } from '../util/config.js';

// Strips the "Search on Bing to/for …" boilerplate that appears in most activity
// descriptions and returns the remainder as a usable search query.
// If the description is unhelpful, falls back to the title text.
function generateSearchQuery(title, description) {
  const BOILERPLATE = [
    /^search on bing (?:to |for )?/i,
    /^search bing (?:to |for )?/i,
    /^use bing to /i,
    /^bing search (?:to |for )?/i,
  ];

  let base = (description || '').trim();
  for (const re of BOILERPLATE) {
    base = base.replace(re, '').trim();
  }

  if (base.length < 8) base = (title || '').trim();

  return base.slice(0, 80).trim();
}

// Maps each activity to a query (may be null if none could be generated).
export function buildSearchList(activities) {
  return activities.map(({ title, description, href }) => {
    const query = generateSearchQuery(title, description);
    return query
      ? { title, description, href, query, unmatched: false }
      : { title, description, href, query: null, unmatched: true };
  });
}

export async function run(ctx) {
  let resolveLocal;
  const result = new Promise(resolve => { resolveLocal = resolve; });

  const timeout = setTimeout(() => {
    ctx.session.resolveActivities = null;
    closeRewardsTab();
    ctx.dbg('warn', 'Rewards page timed out — no activities');
    resolveLocal({ activities: [], domDebug: null, dailySets: [], dailySetDebug: null, loggedIn: true });
  }, 20000);

  const rewardsTab = await chrome.tabs.create({ url: REWARDS_URL, active: false }).catch(() => null);
  if (!rewardsTab) {
    clearTimeout(timeout);
    ctx.session.resolveActivities = null;
    ctx.dbg('error', 'Failed to open rewards tab');
    resolveLocal({ activities: [], domDebug: null, dailySets: [], dailySetDebug: null, loggedIn: true });
    return result;
  }

  ctx.session.openedTabIds.add(rewardsTab.id);
  ctx.session.rewardsTabId = rewardsTab.id;

  // Rewards tab stays open after resolving — background will click cards and then close it.
  ctx.session.resolveActivities = ({ activities = [], domDebug = null, dailySets = [], dailySetDebug = null, loggedIn = true } = {}) => {
    clearTimeout(timeout);
    resolveLocal({ activities, domDebug, dailySets, dailySetDebug, loggedIn });
  };

  return result;
}
