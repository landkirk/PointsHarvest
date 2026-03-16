import { REWARDS_URL } from './util/config.js';
import { MSG_ACTION } from './util/messaging.js';
import { session, loadState, resetState } from './util/state.js';
import { dbg } from './util/debug.js';
import { StartRun, getActiveOrchestrator } from './orchestrators/start-run.js';
import { StopRun } from './orchestrators/stop-run.js';

const startRun = new StartRun();
const stopRun = new StopRun();

// ── Tab event listeners ────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  getActiveOrchestrator()?.onTabUpdated(tabId, changeInfo);

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

chrome.tabs.onCreated.addListener((tab) => {
  getActiveOrchestrator()?.onTabCreated(tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  getActiveOrchestrator()?.onTabRemoved(tabId);
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
    getActiveOrchestrator()?.onUserActionComplete();
    return;
  }
});

// ── Lifecycle ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  resetState();
});
