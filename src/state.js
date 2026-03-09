// Shared in-memory state for the service worker.
// Reset whenever the service worker restarts.
export const state = {
  pendingTabId: null,         // search tab we're waiting on to load
  pendingResolve: null,       // resolves when pendingTabId finishes loading
  resolveActivities: null,    // resolves fetchAvailableActivities() promise
  captureNextTabResolve: null, // resolves with the tab opened by a card click
  openedTabIds: new Set(),    // all tabs this extension has opened
  isActivelyRunning: false,   // distinguishes "storage says running" from "actually running"
  rewardsTabId: null,         // the rewards dashboard tab — kept open until all cards are clicked
};

export function closeRewardsTab() {
  if (state.rewardsTabId) {
    chrome.tabs.remove(state.rewardsTabId).catch(() => {});
    state.rewardsTabId = null;
  }
}
