import { MSG_ACTION } from './util/messaging.js';
import type { AppMessage } from './util/messaging.js';
import {
  loadRunState,
  loadPreferences,
  resetRunState,
  setRunState,
  setHeaderState,
  setPreference,
  INITIAL_PREFERENCES,
} from './util/persistent-state.js';
import { StartRun, getActiveController, getActiveContext } from './managers/start-run.js';
import { StopRun } from './managers/stop-run.js';
import { KEEPALIVE_PORT } from './util/config.js';

const startRun = new StartRun();
const stopRun = new StopRun(startRun.tabs);

// ── Initialization ─────────────────────────────────────────────────────────

try {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
} catch {
  /* setPanelBehavior requires a user-gesture context; unavailable during SW cold boot in some Chrome builds */
}

// ── Keepalive ─────────────────────────────────────────────────────────────
// A long-lived port from the side panel keeps the worker alive continuously.

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === KEEPALIVE_PORT) {
    port.onMessage.addListener(() => {
      // Heartbeat received — no action needed; the message itself resets the idle timer.
    });
  }
});

// ── Tab event listeners ────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  getActiveContext()?.activeOrchestrator?.onTabUpdated(tabId, changeInfo);
});

chrome.tabs.onCreated.addListener((tab) => {
  getActiveContext()?.activeOrchestrator?.onTabCreated(tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  getActiveContext()?.activeOrchestrator?.onTabRemoved(tabId);
});

// ── Message routing ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: AppMessage, _sender, sendResponse) => {
  if (msg.action === MSG_ACTION.START) {
    startRun.run(msg.skipWarmUp, msg.windowId);
  }
  if (msg.action === MSG_ACTION.STOP) {
    stopRun.run();
  }
  if (msg.action === MSG_ACTION.GET_RUN_STATE) {
    loadRunState().then((run) => sendResponse(run));
    return true;
  }
  if (msg.action === MSG_ACTION.GET_PREFERENCES) {
    loadPreferences().then((prefs) => sendResponse(prefs));
    return true;
  }
  if (msg.action === MSG_ACTION.PING) {
    sendResponse({ running: getActiveController() !== null });
    return true;
  }
  if (msg.action === MSG_ACTION.PURGE) {
    Promise.all([resetRunState(), setPreference(INITIAL_PREFERENCES)]).then(() =>
      sendResponse({ ok: true }),
    );
    return true;
  }
  if (msg.action === MSG_ACTION.USER_ACTION_COMPLETE) {
    const orch = getActiveContext()?.activeOrchestrator;
    if (orch) {
      orch.onUserActionComplete();
    } else {
      // Worker restarted mid-linger — clear stale UI state
      setRunState({ isRunning: false, isLingering: false }).then(() =>
        setHeaderState({ headerMessage: 'Stopped', activePhase: null }),
      );
    }
  }
  if (msg.action === MSG_ACTION.RESET_STALE) {
    setRunState({ isRunning: false, isLingering: false }).then(() =>
      setHeaderState({ headerMessage: 'Stopped', activePhase: null }),
    );
  }
  if (msg.action === MSG_ACTION.SET_PREFERENCE) {
    setPreference(msg.updates);
  }
  return undefined;
});

// ── Lifecycle ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await resetRunState();
});
