import { REWARDS_URL } from './config.js';
import { dbg, resetLog, randMs, sleep } from './debug.js';
import { performSearchInTab } from './search.js';

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
let captureNextTabResolve = null; // set just before each card click to capture the opened tab
const openedTabIds = new Set();   // all tabs this extension has opened
let isActivelyRunning = false;    // distinguishes "storage says running" from "actually running"
let rewardsTabId = null;          // the rewards dashboard tab — kept open until all cards are clicked

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

  // If what's left is too short, use the title instead
  if (base.length < 8) base = (title || '').trim();

  return base.slice(0, 80).trim();
}

// ── Run helpers ────────────────────────────────────────────────────────────

function closeRewardsTab() {
  if (rewardsTabId) { chrome.tabs.remove(rewardsTabId).catch(() => {}); rewardsTabId = null; }
}

async function abortRun(status, errorMsg) {
  isActivelyRunning = false;
  closeRewardsTab();
  await chrome.storage.local.set({ isRunning: false, status });
  await dbg('error', errorMsg);
  chrome.runtime.sendMessage({ action: 'complete' }).catch(() => {});
}

// ── Top-level listeners ────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Signal search tab loaded
  if (changeInfo.status === 'complete' && tabId === pendingTabId && pendingResolve) {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve();
  }

  // Detect when the rewards tab finishes loading
  if (tabId === rewardsTabId && changeInfo.status === 'complete' && tab.url) {
    if (tab.url.startsWith(REWARDS_URL)) {
      // Page loaded — tell the content script to begin extraction
      chrome.tabs.sendMessage(tabId, { action: 'startExtract' }).catch(() => {});
    } else {
      // Redirected away from rewards — not logged in
      dbg('error', `Not logged in — redirected to: ${tab.url}`);
      if (resolveActivities) {
        resolveActivities({ activities: [], domDebug: null, loggedIn: false });
        resolveActivities = null;
      }
    }
  }
});

// Capture the tab opened by a card click.
chrome.tabs.onCreated.addListener((tab) => {
  if (captureNextTabResolve && tab.id !== rewardsTabId) {
    const resolve = captureNextTabResolve;
    captureNextTabResolve = null;
    resolve(tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  openedTabIds.delete(tabId);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'activitiesFound') {
    if (resolveActivities) {
      resolveActivities({ activities: msg.activities, domDebug: msg.domDebug, loggedIn: msg.loggedIn !== false });
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

  resetLog();
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

  // Step 1: open rewards dashboard and extract activity cards (no clicking yet)
  await dbg('info', `Opening ${REWARDS_URL}`);
  const { activities, domDebug, loggedIn } = await fetchAvailableActivities();

  if (!isActivelyRunning) { await dbg('warn', 'Stopped during activity fetch'); return; }

  if (!loggedIn) {
    await abortRun('Not logged in — sign into Bing first', 'Aborting: not logged into Bing Rewards');
    return;
  }

  await chrome.storage.local.set({ extractedActivities: activities, domDebug });
  await dbg('info', `DOM scan: ${domDebug?.actionElementsFound ?? '?'} "Search on Bing" cards found, ${domDebug?.skippedLocked ?? 0} locked`);

  if (activities.length === 0) {
    await abortRun('No activity cards found — check Debug panel', 'Aborting: no "Search on Bing" activity cards detected on the rewards page');
    return;
  }

  await dbg('success', `Found ${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}`);

  // Step 2: map activities → queries
  const mapped = buildSearchList(activities);
  await chrome.storage.local.set({ mappedActivities: mapped, searchQueue: mapped.filter(m => m.query).map(m => m.query) });
  chrome.runtime.sendMessage({ action: 'debugReady' }).catch(() => {});

  const unmapped = mapped.filter(m => m.unmatched).length;
  await dbg('info', `Mapped ${mapped.length - unmapped}/${mapped.length} activit${mapped.length === 1 ? 'y' : 'ies'} (${unmapped} unmatched)`);

  // Step 3: resume or start fresh
  const startIndex = (lastRunDate === today && currentIndex > 0 && !alreadyDone) ? currentIndex : 0;
  await chrome.storage.local.set({
    totalSearches: mapped.length,
    currentIndex: startIndex,
    completedSearches: startIndex,
    status: `Running (0 / ${mapped.length})`,
  });

  // Initial random delay before the first search (0–8s)
  const initialDelay = randMs(0, 8000);
  await dbg('info', `Initial delay: ${(initialDelay / 1000).toFixed(1)}s`);
  await sleep(initialDelay);

  if (!isActivelyRunning) {
    closeRewardsTab();
    return;
  }

  runAllSearches(mapped, startIndex);
}

async function stopRun() {
  isActivelyRunning = false;
  await chrome.storage.local.set({ isRunning: false, status: 'Stopped' });
  await dbg('warn', 'Run stopped by user');
  if (pendingResolve) { pendingResolve(); pendingResolve = null; }
  if (resolveActivities) { resolveActivities({}); resolveActivities = null; }
  if (captureNextTabResolve) { captureNextTabResolve(null); captureNextTabResolve = null; }
  for (const tabId of openedTabIds) {
    chrome.tabs.remove(tabId).catch(() => {});
  }
  openedTabIds.clear();
  pendingTabId = null;
  rewardsTabId = null;
}

async function fetchAvailableActivities() {
  let resolveLocal;
  const result = new Promise(resolve => { resolveLocal = resolve; });

  const timeout = setTimeout(() => {
    resolveActivities = null;
    closeRewardsTab();
    dbg('warn', 'Rewards page timed out — no activities');
    resolveLocal({ activities: [], domDebug: null, loggedIn: true });
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

  // Rewards tab stays open after resolving — background will click cards and then close it.
  resolveActivities = ({ activities = [], domDebug = null, loggedIn = true } = {}) => {
    clearTimeout(timeout);
    resolveLocal({ activities, domDebug, loggedIn });
  };

  return result;
}

// Maps each activity to a query (may be null if none could be generated).
function buildSearchList(activities) {
  return activities.map(({ title, description }) => {
    const query = generateSearchQuery(title, description);
    return query
      ? { title, description, query, unmatched: false }
      : { title, description, query: null, unmatched: true };
  });
}

async function runAllSearches(mapped, startIndex) {
  for (let i = startIndex; i < mapped.length; i++) {
    if (!isActivelyRunning) return;

    const { query, title } = mapped[i];

    if (!query) {
      await dbg('warn', `Skipping card ${i + 1} — no query could be generated for "${title}"`);
      continue;
    }

    const label = query.length > 40 ? query.slice(0, 40) + '…' : query;
    await chrome.storage.local.set({ currentIndex: i, status: `Searching: "${label}"` });
    await dbg('info', `[${i + 1}/${mapped.length}] Clicking card: "${title}"`);

    // Set up capture before sending click — tab may open before sendMessage resolves
    const captureTabPromise = new Promise(resolve => { captureNextTabResolve = resolve; });

    const clickResult = await chrome.tabs.sendMessage(rewardsTabId, { action: 'clickCard', index: i })
      .catch(() => null);

    if (!clickResult?.clicked) {
      captureNextTabResolve = null;
      await dbg('warn', `Card click failed for "${title}": ${clickResult?.error ?? 'no response'}`);
      continue;
    }

    const searchTab = await Promise.race([captureTabPromise, sleep(10000).then(() => null)]);
    captureNextTabResolve = null;

    if (!searchTab) {
      await dbg('warn', `No tab opened after clicking card "${title}"`);
      continue;
    }

    openedTabIds.add(searchTab.id);

    // Wait for the tab to finish loading
    pendingTabId = searchTab.id;
    await Promise.race([
      new Promise(resolve => { pendingResolve = resolve; }),
      sleep(30000),
    ]);
    pendingResolve = null;
    pendingTabId = null;

    if (!isActivelyRunning) {
      chrome.tabs.remove(searchTab.id).catch(() => {});
      return;
    }

    await performSearchInTab(searchTab.id, query);
    chrome.tabs.remove(searchTab.id).catch(() => {});

    if (!isActivelyRunning) return;

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
      if (!isActivelyRunning) return;
    }
  }

  // Close the rewards tab now that all cards have been clicked
  closeRewardsTab();

  isActivelyRunning = false;
  await chrome.storage.local.set({ isRunning: false, status: 'Done for today!' });
  await dbg('success', 'All searches complete');
  chrome.runtime.sendMessage({ action: 'complete' }).catch(() => {});
}

