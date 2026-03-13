// Shared in-memory state for the service worker.
// Reset whenever the service worker restarts.
import { sleep } from './util/debug.js';

export const state = {
  pendingTabId: null,         // search tab we're waiting on to load
  pendingResolve: null,       // resolves when pendingTabId finishes loading
  resolveActivities: null,    // resolves fetchAvailableActivities() promise
  captureNextTabResolve: null, // resolves with the tab opened by a card click
  openedTabIds: new Set(),    // all tabs this extension has opened
  isActivelyRunning: false,   // distinguishes "storage says running" from "actually running"
  rewardsTabId: null,         // the rewards dashboard tab — kept open until all cards are clicked
  lingerTabId: null,          // tab the user needs to interact with (requiresUserAction tiles)
  lingerResolve: null,        // resolves lingerOnTab()'s promise
};

export function closeRewardsTab() {
  if (state.rewardsTabId) {
    chrome.tabs.remove(state.rewardsTabId).catch(() => {});
    state.rewardsTabId = null;
  }
}

// Waits for a tab to reach 'complete' status (via chrome.tabs.onUpdated) or times out.
export async function waitForTabLoad(tabId, timeoutMs = 30000) {
  state.pendingTabId = tabId;
  await Promise.race([
    new Promise(resolve => { state.pendingResolve = resolve; }),
    sleep(timeoutMs),
  ]);
  state.pendingResolve = null;
  state.pendingTabId = null;
}
