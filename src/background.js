import { REWARDS_URL, MSG_ACTION } from './util/config.js';
import { dbg, resetLog, randMs, sleep } from './util/debug.js';
import { state, closeRewardsTab } from './state.js';
import { fetchAvailableActivities, buildSearchList } from './steps/fetch-activities.js';
import { runAllSearches } from './steps/run-searches.js';

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

// ── Run helpers ────────────────────────────────────────────────────────────

async function abortRun(status, errorMsg) {
  state.isActivelyRunning = false;
  closeRewardsTab();
  await chrome.storage.local.set({ isRunning: false, status });
  await dbg('error', errorMsg);
  chrome.runtime.sendMessage({ action: MSG_ACTION.COMPLETE }).catch(() => {});
}

// ── Top-level listeners ────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Signal search tab loaded
  if (changeInfo.status === 'complete' && tabId === state.pendingTabId && state.pendingResolve) {
    const resolve = state.pendingResolve;
    state.pendingResolve = null;
    resolve();
  }

  // Detect when the rewards tab finishes loading
  if (tabId === state.rewardsTabId && changeInfo.status === 'complete' && tab.url) {
    if (tab.url.startsWith(REWARDS_URL)) {
      // Page loaded — tell the content script to begin extraction
      chrome.tabs.sendMessage(tabId, { action: MSG_ACTION.START_EXTRACT }).catch(() => {});
    } else {
      // Redirected away from rewards — not logged in
      dbg('error', `Not logged in — redirected to: ${tab.url}`);
      if (state.resolveActivities) {
        state.resolveActivities({ activities: [], domDebug: null, loggedIn: false });
        state.resolveActivities = null;
      }
    }
  }
});

// Capture the tab opened by a card click.
chrome.tabs.onCreated.addListener((tab) => {
  if (state.captureNextTabResolve && tab.id !== state.rewardsTabId) {
    const resolve = state.captureNextTabResolve;
    state.captureNextTabResolve = null;
    resolve(tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  state.openedTabIds.delete(tabId);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === MSG_ACTION.ACTIVITIES_FOUND) {
    if (state.resolveActivities) {
      state.resolveActivities({ activities: msg.activities, domDebug: msg.domDebug, loggedIn: msg.loggedIn !== false });
      state.resolveActivities = null;
    }
    return;
  }
  if (msg.action === MSG_ACTION.START) {
    startRun().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === MSG_ACTION.STOP) {
    stopRun().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === MSG_ACTION.GET_STATE) {
    chrome.storage.local.get(null).then(sendResponse);
    return true;
  }
  if (msg.action === MSG_ACTION.PING) {
    sendResponse({ running: state.isActivelyRunning });
    return true;
  }
  if (msg.action === MSG_ACTION.PURGE) {
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

  state.isActivelyRunning = true;
  await dbg('info', 'Run started');

  // Step 1: open rewards dashboard and extract activity cards (no clicking yet)
  await dbg('info', `Opening ${REWARDS_URL}`);
  const { activities, domDebug, loggedIn } = await fetchAvailableActivities();

  if (!state.isActivelyRunning) { await dbg('warn', 'Stopped during activity fetch'); return; }

  if (!loggedIn) {
    await abortRun('Not logged in — sign into Bing first', 'Aborting: not logged into Bing Rewards');
    return;
  }

  await chrome.storage.local.set({ extractedActivities: activities, domDebug });
  await dbg('info', `DOM scan: ${domDebug?.actionElementsFound ?? '?'} actionable, ${domDebug?.skippedLocked ?? 0} locked, ${domDebug?.skippedCompleted ?? 0} completed, ${domDebug?.skippedUnknown ?? 0} unknown (skipped)`);

  if (activities.length === 0) {
    await abortRun('No valid activity cards found — check Debug panel', 'Aborting: no valid activity cards detected on the rewards page');
    return;
  }

  await dbg('success', `Found ${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}`);

  // Step 2: map activities → queries
  const mapped = buildSearchList(activities);
  await chrome.storage.local.set({ mappedActivities: mapped, searchQueue: mapped.filter(m => m.query).map(m => m.query) });
  chrome.runtime.sendMessage({ action: MSG_ACTION.DEBUG_READY }).catch(() => {});

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

  if (!state.isActivelyRunning) {
    closeRewardsTab();
    return;
  }

  runAllSearches(mapped, startIndex);
}

async function stopRun() {
  state.isActivelyRunning = false;
  await chrome.storage.local.set({ isRunning: false, status: 'Stopped' });
  await dbg('warn', 'Run stopped by user');
  if (state.pendingResolve) { state.pendingResolve(); state.pendingResolve = null; }
  if (state.resolveActivities) { state.resolveActivities({}); state.resolveActivities = null; }
  if (state.captureNextTabResolve) { state.captureNextTabResolve(null); state.captureNextTabResolve = null; }
  for (const tabId of state.openedTabIds) {
    chrome.tabs.remove(tabId).catch(() => {});
  }
  state.openedTabIds.clear();
  state.pendingTabId = null;
  state.rewardsTabId = null;
}
