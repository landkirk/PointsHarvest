import { REWARDS_URL, MSG_ACTION } from './util/config.js';
import { dbg, resetLog, randMs, sleep } from './util/debug.js';
import { session, resetSession, loadState, setState, resetState } from './util/state.js';
import { closeRewardsTab } from './util/tabs.js';
import { fetchAvailableActivities, buildSearchList } from './steps/fetch-activities.js';
import { runAllSearches } from './steps/run-searches.js';

// ── Run helpers ────────────────────────────────────────────────────────────

async function abortRun(status, errorMsg) {
  session.isActivelyRunning = false;
  closeRewardsTab();
  await setState({ isRunning: false, status });
  await dbg('error', errorMsg);
  chrome.runtime.sendMessage({ action: MSG_ACTION.COMPLETE }).catch(() => {});
}

// ── Top-level listeners ────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Signal search tab loaded
  if (changeInfo.status === 'complete' && tabId === session.pendingTabId && session.pendingResolve) {
    const resolve = session.pendingResolve;
    session.pendingResolve = null;
    resolve();
  }

  // Detect when the rewards tab finishes loading
  if (tabId === session.rewardsTabId && changeInfo.status === 'complete' && tab.url) {
    if (tab.url.startsWith(REWARDS_URL)) {
      // Page loaded — tell the content script to begin extraction
      chrome.tabs.sendMessage(tabId, { action: MSG_ACTION.START_EXTRACT }).catch(() => {});
    } else {
      // Redirected away from rewards — not logged in
      dbg('error', `Not logged in — redirected to: ${tab.url}`);
      if (session.resolveActivities) {
        session.resolveActivities({ activities: [], domDebug: null, loggedIn: false });
        session.resolveActivities = null;
      }
    }
  }
});

// Capture the tab opened by a card click.
chrome.tabs.onCreated.addListener((tab) => {
  if (session.captureNextTabResolve && tab.id !== session.rewardsTabId) {
    const resolve = session.captureNextTabResolve;
    session.captureNextTabResolve = null;
    resolve(tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  session.openedTabIds.delete(tabId);
  // If the user closes a linger tab directly, treat it as completing the action.
  if (tabId === session.lingerTabId && session.lingerResolve) {
    const resolve = session.lingerResolve;
    session.lingerResolve = null;
    resolve();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === MSG_ACTION.ACTIVITIES_FOUND) {
    if (session.resolveActivities) {
      session.resolveActivities({
        activities: msg.activities,
        domDebug: msg.domDebug,
        dailySets: msg.dailySets ?? [],
        dailySetDebug: msg.dailySetDebug ?? null,
        loggedIn: msg.loggedIn !== false,
      });
      session.resolveActivities = null;
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
    loadState().then(sendResponse);
    return true;
  }
  if (msg.action === MSG_ACTION.PING) {
    sendResponse({ running: session.isActivelyRunning });
    return true;
  }
  if (msg.action === MSG_ACTION.PURGE) {
    resetState().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === MSG_ACTION.USER_ACTION_COMPLETE) {
    if (session.lingerResolve) {
      const resolve = session.lingerResolve;
      session.lingerResolve = null;
      if (session.lingerTabId) chrome.tabs.remove(session.lingerTabId).catch(() => {});
      resolve();
    }
    return;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  resetState();
});

// ── Main flow ──────────────────────────────────────────────────────────────

async function startRun() {
  const today = new Date().toDateString();
  const { lastRunDate, currentIndex, completedSearches } = await loadState();
  const alreadyDone = lastRunDate === today && completedSearches > 0 && currentIndex >= completedSearches;

  resetSession();
  resetLog();
  await resetState({ isRunning: true, status: 'Fetching rewards activities...', lastRunDate: today });

  session.isActivelyRunning = true;
  await dbg('info', 'Run started');

  // Step 1: open rewards dashboard and extract activity cards (no clicking yet)
  await dbg('info', `Opening ${REWARDS_URL}`);
  const { activities, domDebug, dailySets, dailySetDebug, loggedIn } = await fetchAvailableActivities();

  if (!session.isActivelyRunning) { await dbg('warn', 'Stopped during activity fetch'); return; }

  if (!loggedIn) {
    await abortRun('Not logged in — sign into Bing first', 'Aborting: not logged into Bing Rewards');
    return;
  }

  await setState({ extractedActivities: activities, domDebug, dailySetDebug });
  await dbg('info', `DOM scan: ${domDebug?.actionElementsFound ?? '?'} actionable, ${domDebug?.skippedLocked ?? 0} locked, ${domDebug?.skippedCompleted ?? 0} completed, ${domDebug?.skippedUnknown ?? 0} unknown (skipped)`);
  await dbg('info', `Daily sets: ${dailySetDebug?.actionable ?? 0} actionable (section ${dailySetDebug?.sectionFound ? 'found' : 'not found'})`);

  if (activities.length === 0 && dailySets.length === 0) {
    await abortRun('No valid activity cards found — check Debug panel', 'Aborting: no valid activity cards detected on the rewards page');
    return;
  }

  await dbg('success', `Found ${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}`);

  // Step 2: map activities → queries
  const mapped = buildSearchList(activities);
  await setState({ mappedActivities: mapped, searchQueue: mapped.filter(m => m.query).map(m => m.query) });
  chrome.runtime.sendMessage({ action: MSG_ACTION.DEBUG_READY }).catch(() => {});

  const unmapped = mapped.filter(m => m.unmatched).length;
  await dbg('info', `Mapped ${mapped.length - unmapped}/${mapped.length} activit${mapped.length === 1 ? 'y' : 'ies'} (${unmapped} unmatched)`);

  // Step 3: resume or start fresh
  const startIndex = (lastRunDate === today && currentIndex > 0 && !alreadyDone) ? currentIndex : 0;
  await setState({
    totalSearches: mapped.length,
    currentIndex: startIndex,
    completedSearches: startIndex,
    status: `Running (0 / ${mapped.length})`,
  });

  // Initial random delay before the first search (0–8s)
  const initialDelay = randMs(0, 8000);
  await dbg('info', `Initial delay: ${(initialDelay / 1000).toFixed(1)}s`);
  await sleep(initialDelay);

  if (!session.isActivelyRunning) {
    closeRewardsTab();
    return;
  }

  runAllSearches(mapped, startIndex, dailySets);
}

async function stopRun() {
  session.isActivelyRunning = false;
  await setState({ isRunning: false, status: 'Stopped' });
  await dbg('warn', 'Run stopped by user');
  if (session.pendingResolve) { session.pendingResolve(); session.pendingResolve = null; }
  if (session.resolveActivities) { session.resolveActivities({}); session.resolveActivities = null; }
  if (session.captureNextTabResolve) { session.captureNextTabResolve(null); session.captureNextTabResolve = null; }
  if (session.lingerResolve) { session.lingerResolve(); session.lingerResolve = null; }
  session.lingerTabId = null;
  for (const tabId of session.openedTabIds) {
    chrome.tabs.remove(tabId).catch(() => {});
  }
  session.openedTabIds.clear();
  session.pendingTabId = null;
  session.rewardsTabId = null;
}
