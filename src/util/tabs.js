import { session } from './state.js';
import { sleep } from './debug.js';

/** Close the rewards dashboard and breakdown tabs and clear their session references. */
export function closeRewardsTab() {
  if (session.rewardsTabId) {
    chrome.tabs.remove(session.rewardsTabId).catch(() => {});
    session.rewardsTabId = null;
  }
  if (session.breakdownTabId) {
    chrome.tabs.remove(session.breakdownTabId).catch(() => {});
    session.breakdownTabId = null;
  }
}

/** Wait for a tab to reach 'complete' status (via chrome.tabs.onUpdated) or time out. */
export async function waitForTabLoad(tabId, timeoutMs = 30000) {
  session.pendingTabId = tabId;
  await Promise.race([
    new Promise(resolve => { session.pendingResolve = resolve; }),
    sleep(timeoutMs),
  ]);
  session.pendingResolve = null;
  session.pendingTabId = null;
}
