import { REWARDS_URL } from './util/config.js';
import { MSG_ACTION } from './util/messaging.js';
import { session, loadState, resetState } from './util/state.js';
import { dbg } from './util/debug.js';
import { StartRun } from './orchestrators/start-run.js';
import { StopRun } from './orchestrators/stop-run.js';

const startRun = new StartRun();
const stopRun = new StopRun();

// ── Tab event listeners ────────────────────────────────────────────────────

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
      // Main page loaded — tell the content script to begin extraction
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
  if (session.captureNextTabResolve && tab.id !== session.rewardsTabId && tab.id !== session.breakdownTabId) {
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

// ── Message routing ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse): true | void => {
  if (msg.action === MSG_ACTION.ACTIVITIES_FOUND) {
    if (session.resolveActivities) {
      session.resolveActivities({
        activities:   msg.activities,
        domDebug:     msg.domDebug,
        dailySets:    msg.dailySets ?? [],
        dailySetDebug: msg.dailySetDebug ?? null,
        loggedIn:     msg.loggedIn !== false,
      });
      session.resolveActivities = null;
    }
    return;
  }
  if (msg.action === MSG_ACTION.START) {
    startRun.run().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === MSG_ACTION.STOP) {
    stopRun.run().then(() => sendResponse({ ok: true }));
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

// ── Lifecycle ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  resetState();
});
