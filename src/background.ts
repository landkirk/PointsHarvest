import { MSG_ACTION } from './util/messaging.js';
import type { AppMessage } from './util/messaging.js';
import { loadState, resetState, setState, setHeaderState } from './util/persistent-state.js';
import { getActiveOrchestrator } from './util/runtime-state.js';
import { StartRun, getActiveController } from './managers/start-run.js';
import { StopRun } from './managers/stop-run.js';
import { KEEPALIVE_ALARM } from './util/config.js';

const startRun = new StartRun();
const stopRun = new StopRun(startRun.tabs);

// ── Initialization ─────────────────────────────────────────────────────────

try {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
} catch {
  /* setPanelBehavior requires a user-gesture context; unavailable during SW cold boot in some Chrome builds */
}

// ── Keepalive alarm ───────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // Any Chrome API call resets the 30s service worker idle timer.
    chrome.storage.local.get('isRunning');
  }
});

// ── Tab event listeners ────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  getActiveOrchestrator()?.onTabUpdated(tabId, changeInfo);
});

chrome.tabs.onCreated.addListener((tab) => {
  getActiveOrchestrator()?.onTabCreated(tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  getActiveOrchestrator()?.onTabRemoved(tabId);
});

// ── Message routing ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: AppMessage, _sender, sendResponse) => {
  if (msg.action === MSG_ACTION.START) {
    startRun.run(msg.skipWarmUp, msg.windowId);
  }
  if (msg.action === MSG_ACTION.STOP) {
    stopRun.run();
  }
  if (msg.action === MSG_ACTION.GET_STATE) {
    loadState().then(sendResponse);
    return true;
  }
  if (msg.action === MSG_ACTION.PING) {
    sendResponse({ running: getActiveController() !== null });
    return true;
  }
  if (msg.action === MSG_ACTION.PURGE) {
    resetState({ seenScreenIds: [], ignoredUpdateVersion: null }).then(() =>
      sendResponse({ ok: true }),
    );
    return true;
  }
  if (msg.action === MSG_ACTION.USER_ACTION_COMPLETE) {
    const orch = getActiveOrchestrator();
    if (orch) {
      orch.onUserActionComplete();
    } else {
      // Worker restarted mid-linger — clear stale UI state
      chrome.alarms.clear(KEEPALIVE_ALARM);
      setState({ isRunning: false, isLingering: false }).then(() =>
        setHeaderState({ headerMessage: 'Stopped', activePhase: null }),
      );
    }
  }
  if (msg.action === MSG_ACTION.RESET_STALE) {
    Promise.all([
      chrome.alarms.clear(KEEPALIVE_ALARM),
      setState({ isRunning: false, isLingering: false }),
    ]).then(() => setHeaderState({ headerMessage: 'Stopped', activePhase: null }));
  }
  if (msg.action === MSG_ACTION.SET_PREFERENCE) {
    setState(msg.updates);
  }
  return undefined;
});

// ── Lifecycle ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await Promise.all([chrome.alarms.clear(KEEPALIVE_ALARM), resetState()]);
});
