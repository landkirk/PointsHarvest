import { session } from './state.js';
import { sleep } from './timing.js';
import type { Context } from './context.js';

/**
 * Open a new tab, add it to the session's openedTabIds set, and return it.
 * Throws if the tab could not be created.
 */
export async function openTab(ctx: Context, url: string, active = false): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.create({ url, active }).catch(() => null);
  if (!tab) throw new Error(`Failed to open tab: ${url}`);
  ctx.session.openedTabIds.add(tab.id!);
  return tab;
}

/** Close the rewards dashboard and breakdown tabs and clear their session references. */
export function closeRewardsTab(): void {
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
export async function waitForTabLoad(tabId: number, timeoutMs = 30000): Promise<void> {
  session.pendingTabId = tabId;
  await Promise.race([
    new Promise<void>(resolve => { session.pendingResolve = resolve; }),
    sleep(timeoutMs),
  ]);
  session.pendingResolve = null;
  session.pendingTabId = null;
}
