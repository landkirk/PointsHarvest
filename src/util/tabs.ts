import { sleep } from './timing.js';

/** Open a new tab and return it. Throws if the tab could not be created. */
export async function openTab(url: string, active = false): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.create({ url, active }).catch(() => null);
  if (!tab) throw new Error(`Failed to open tab: ${url}`);
  return tab;
}

export interface TabLoadState {
  pendingTabId: number | null;
  pendingResolve: (() => void) | null;
}

/** Wait for a tab to reach 'complete' status (via onTabUpdated) or time out. */
export async function waitForTabLoad(
  tabId: number,
  state: TabLoadState,
  timeoutMs = 30000,
): Promise<void> {
  state.pendingTabId = tabId;
  await Promise.race([
    new Promise<void>((resolve) => {
      state.pendingResolve = resolve;
    }),
    sleep(timeoutMs),
  ]);
  state.pendingResolve = null;
  state.pendingTabId = null;
}

/** Close all tabs in the set and clear it. */
export async function closeOwnedTabs(tabIds: Set<number>): Promise<void> {
  for (const tabId of tabIds) {
    chrome.tabs.remove(tabId).catch(() => {});
  }
  tabIds.clear();
}
