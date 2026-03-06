import { ACTIVITY_KEYWORD_MAP, GENERAL_SEARCH_POOL, MIN_SEARCHES, MAX_SEARCHES, REWARDS_URL } from './config.js';

const BLANK_STATE = {
  isRunning: false,
  status: 'idle',
  currentIndex: 0,
  completedSearches: 0,
  totalSearches: 0,
  lastRunDate: null,
  lastLabel: '',
  debugLog: [],
  domDebug: null,
  extractedActivities: [],
  mappedActivities: [],
  searchQueue: [],
};

// In-memory state (reset whenever the service worker restarts)
let pendingTabId = null;
let pendingResolve = null;
let resolveActivities = null;
const openedTabIds = new Set(); // all tabs this extension has opened
let isActivelyRunning = false;  // distinguishes "storage says running" from "actually running"
let rewardsTabId = null;        // the rewards dashboard tab, watched for login redirects
let debugLog = [];              // in-memory log; synced to storage on each dbg() call

// ── Fallback query generation ─────────────────────────────────────────────

// Strips the "Search on Bing to/for …" boilerplate that appears in most activity
// descriptions and returns the remainder as a usable search query.
// If the description is unhelpful, falls back to the title text.
function generateFallbackQuery(title, description) {
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

  // If what's left is too short, use the title instead
  if (base.length < 8) base = (title || '').trim();

  // Trim to a sensible search length
  return base.slice(0, 80).trim();
}

// ── Randomisation helpers ──────────────────────────────────────────────────

// Triangular distribution biased toward the middle of [min, max].
// Feels more human than a flat uniform range.
function randMs(min, max) {
  return Math.round(min + ((Math.random() + Math.random()) / 2) * (max - min));
}

function randItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Debug helpers ──────────────────────────────────────────────────────────

async function dbg(type, message) {
  const entry = { time: new Date().toLocaleTimeString('en-US', { hour12: false }), type, message };
  debugLog = [...debugLog, entry].slice(-100);
  await chrome.storage.local.set({ debugLog });
  chrome.runtime.sendMessage({ action: 'debugEntry', entry }).catch(() => {});
}

// ── Top-level listeners ────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Signal search tab loaded
  if (changeInfo.status === 'complete' && tabId === pendingTabId && pendingResolve) {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve();
  }

  // Detect redirect away from rewards.bing.com after the page fully loads → not logged in
  if (tabId === rewardsTabId && changeInfo.status === 'complete' &&
      tab.url && !tab.url.startsWith(REWARDS_URL)) {
    dbg('error', `Not logged in — redirected to: ${tab.url}`);
    if (resolveActivities) {
      resolveActivities([], null, false); // loggedIn = false
      resolveActivities = null;
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  openedTabIds.delete(tabId);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'activitiesFound') {
    if (resolveActivities) {
      resolveActivities(msg.activities, msg.domDebug, msg.loggedIn !== false);
      resolveActivities = null;
    }
    return;
  }
  if (msg.action === 'start') {
    startRun().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'stop') {
    stopRun().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'getState') {
    chrome.storage.local.get(null).then(sendResponse);
    return true;
  }
  if (msg.action === 'ping') {
    sendResponse({ running: isActivelyRunning });
    return true;
  }
  if (msg.action === 'purgeState') {
    chrome.storage.local.set(BLANK_STATE).then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set(BLANK_STATE);
});

// ── Main flow ──────────────────────────────────────────────────────────────

async function startRun() {
  const today = new Date().toDateString();
  const { lastRunDate, currentIndex, completedSearches } = await chrome.storage.local.get([
    'lastRunDate', 'currentIndex', 'completedSearches',
  ]);
  const alreadyDone = lastRunDate === today && completedSearches > 0 && currentIndex >= completedSearches;

  debugLog = [];
  await chrome.storage.local.set({
    isRunning: true,
    status: 'Fetching rewards activities...',
    lastRunDate: today,
    debugLog: [],
    domDebug: null,
    extractedActivities: [],
    mappedActivities: [],
    searchQueue: [],
  });

  isActivelyRunning = true;
  await dbg('info', 'Run started');

  // Step 1: scrape rewards dashboard
  await dbg('info', `Opening ${REWARDS_URL}`);
  const { activities, domDebug, loggedIn } = await fetchAvailableActivities();

  if (!isActivelyRunning) { await dbg('warn', 'Stopped during activity fetch'); return; }

  if (!loggedIn) {
    isActivelyRunning = false;
    await chrome.storage.local.set({ isRunning: false, status: 'Not logged in — sign into Bing first' });
    await dbg('error', 'Aborting: not logged into Bing Rewards');
    chrome.runtime.sendMessage({ action: 'complete' }).catch(() => {});
    return;
  }

  await chrome.storage.local.set({ extractedActivities: activities, domDebug });
  await dbg('info', `DOM scan: ${domDebug?.actionElementsFound ?? '?'} action elements, ${domDebug?.skippedLocked ?? 0} locked skipped`);
  await dbg('success', `Extracted ${activities.length} available activit${activities.length === 1 ? 'y' : 'ies'}`);

  // Step 2: map activities → queries, shuffle and pad to a random target count
  const targetCount = MIN_SEARCHES + Math.floor(Math.random() * (MAX_SEARCHES - MIN_SEARCHES + 1));
  const { searches, mapped } = buildSearchList(activities, targetCount);
  await chrome.storage.local.set({ mappedActivities: mapped, searchQueue: searches });
  chrome.runtime.sendMessage({ action: 'debugReady' }).catch(() => {});

  const unmapped  = mapped.filter(m => m.unmatched).length;
  const fallbacks = mapped.filter(m => m.fallback).length;
  await dbg('info', `Mapped ${mapped.length - unmapped} activit${mapped.length - unmapped === 1 ? 'y' : 'ies'} (${fallbacks} fallback${fallbacks !== 1 ? 's' : ''}), ${unmapped} fully unmatched`);
  await dbg('info', `Target: ${targetCount} searches (${searches.length - mapped.filter(m => !m.unmatched).length} general fills, queue shuffled)`);

  // Step 3: resume or start fresh
  const startIndex = (lastRunDate === today && currentIndex > 0 && !alreadyDone) ? currentIndex : 0;
  await chrome.storage.local.set({
    totalSearches: searches.length,
    currentIndex: startIndex,
    completedSearches: startIndex,
    status: `Running (0 / ${searches.length})`,
  });

  // Initial random delay before the first search (0–8s)
  const initialDelay = randMs(0, 8000);
  await dbg('info', `Initial delay: ${(initialDelay / 1000).toFixed(1)}s`);
  await sleep(initialDelay);

  if (!isActivelyRunning) return;

  runAllSearches(searches, startIndex);
}

async function stopRun() {
  isActivelyRunning = false;
  await chrome.storage.local.set({ isRunning: false, status: 'Stopped' });
  await dbg('warn', 'Run stopped by user');
  if (pendingResolve) { pendingResolve(); pendingResolve = null; }
  if (resolveActivities) { resolveActivities([], null); resolveActivities = null; }
  // Close every tab this extension opened
  for (const tabId of openedTabIds) {
    chrome.tabs.remove(tabId).catch(() => {});
  }
  openedTabIds.clear();
  pendingTabId = null;
}

async function fetchAvailableActivities() {
  let resolveLocal;
  const result = new Promise(resolve => { resolveLocal = resolve; });

  const timeout = setTimeout(() => {
    resolveActivities = null;
    rewardsTabId = null;
    dbg('warn', 'Rewards page timed out — continuing with no activities');
    resolveLocal({ activities: [], domDebug: null, loggedIn: true }); // assume logged in on timeout
  }, 20000);

  const rewardsTab = await chrome.tabs.create({ url: REWARDS_URL, active: false }).catch(() => null);
  if (!rewardsTab) {
    clearTimeout(timeout);
    resolveActivities = null;
    dbg('error', 'Failed to open rewards tab');
    resolveLocal({ activities: [], domDebug: null, loggedIn: true });
    return result;
  }
  openedTabIds.add(rewardsTab.id);
  rewardsTabId = rewardsTab.id;

  // When content script responds (or redirect detected), close the tab and resolve
  resolveActivities = (activities, domDebug, loggedIn = true) => {
    clearTimeout(timeout);
    rewardsTabId = null;
    chrome.tabs.remove(rewardsTab.id).catch(() => {});
    resolveLocal({ activities, domDebug, loggedIn });
  };

  return result;
}

function buildSearchList(activities, targetCount) {
  const mapped = [];
  const seen = new Set(); // dedup across activity queries and general fills

  // Map each activity to a randomly chosen query variant, then shuffle
  const activityQueries = [];
  for (const { title, description } of activities) {
    const text = `${title} ${description}`.toLowerCase();
    const match = ACTIVITY_KEYWORD_MAP.find(({ keywords }) =>
      keywords.some(kw => text.includes(kw))
    );
    if (match) {
      const query = randItem(match.queries); // pick a random variant
      const keyword = match.keywords.find(kw => text.includes(kw));
      if (!seen.has(query)) {
        seen.add(query);
        activityQueries.push(query);
        mapped.push({ title, description, query, keyword, unmatched: false, fallback: false });
      }
    } else {
      // No keyword match — generate a query directly from the activity text
      const query = generateFallbackQuery(title, description);
      if (query && !seen.has(query)) {
        seen.add(query);
        activityQueries.push(query);
        mapped.push({ title, description, query, keyword: null, unmatched: false, fallback: true });
      } else {
        mapped.push({ title, description, query: null, keyword: null, unmatched: true, fallback: false });
      }
    }
  }

  // Shuffle the activity queries so order varies each run
  const queries = shuffle(activityQueries);

  // Pad with shuffled general searches until we hit targetCount
  const generalPool = shuffle(GENERAL_SEARCH_POOL);
  for (const q of generalPool) {
    if (queries.length >= targetCount) break;
    if (!seen.has(q)) { seen.add(q); queries.push(q); }
  }

  // Shuffle the full combined list so activities don't always come first
  const finalQueue = shuffle(queries);

  return { searches: finalQueue, mapped };
}

async function runAllSearches(searches, startIndex) {
  for (let i = startIndex; i < searches.length; i++) {
    if (!isActivelyRunning) return;

    const q = searches[i];
    const label = q.length > 40 ? q.slice(0, 40) + '…' : q;
    await chrome.storage.local.set({ currentIndex: i, status: `Searching: "${label}"` });
    await dbg('info', `[${i + 1}/${searches.length}] "${q}"`);

    await performSearch(q);

    // Re-check: stop may have been called during the search's dwell wait
    if (!isActivelyRunning) return;

    const completed = i + 1;
    await chrome.storage.local.set({
      completedSearches: completed,
      lastLabel: q,
      status: `Running (${completed} / ${searches.length})`,
    });
    await dbg('success', `Search ${completed}/${searches.length} complete`);

    chrome.runtime.sendMessage({
      action: 'progress',
      completed,
      total: searches.length,
      label: q,
    }).catch(() => {});

    if (i < searches.length - 1) {
      const delay = randMs(1800, 5000);
      await dbg('info', `Next search in ${(delay / 1000).toFixed(1)}s`);
      await sleep(delay);
      if (!isActivelyRunning) return;
    }
  }

  isActivelyRunning = false;
  await chrome.storage.local.set({ isRunning: false, status: 'Done for today!' });
  await dbg('success', 'All searches complete');
  chrome.runtime.sendMessage({ action: 'complete' }).catch(() => {});
}

async function performSearch(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const tab = await chrome.tabs.create({ url, active: false }).catch(() => null);
  if (!tab) { await dbg('error', `Failed to open tab for: ${query}`); return; }
  openedTabIds.add(tab.id);

  pendingTabId = tab.id;

  await Promise.race([
    new Promise(resolve => { pendingResolve = resolve; }),
    sleep(30000),
  ]);

  pendingResolve = null;
  pendingTabId = null;

  // Random dwell time after page load (1.8s–4.5s)
  const dwell = randMs(1800, 4500);
  await dbg('info', `Dwell: ${(dwell / 1000).toFixed(1)}s`);
  await sleep(dwell);

  chrome.tabs.remove(tab.id).catch(() => {});
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
