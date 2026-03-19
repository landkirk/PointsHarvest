import { MSG_ACTION } from './util/messaging.js';
import { loadState, resetState, getActiveOrchestrator, getIsActivelyRunning } from './util/state.js';
import { StartRun } from './orchestrators/start-run.js';
import { StopRun } from './orchestrators/stop-run.js';

const startRun = new StartRun();
const stopRun = new StopRun();

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
    sendResponse({ running: getIsActivelyRunning() });
    return true;
  }
  if (msg.action === MSG_ACTION.PURGE) {
    resetState({ seenScreenIds: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === MSG_ACTION.USER_ACTION_COMPLETE) {
    getActiveOrchestrator()?.onUserActionComplete();
  }
  return undefined;
});

// ── Lifecycle ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await resetState();
});
