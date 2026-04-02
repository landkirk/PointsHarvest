import type { Context } from './context.js';

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

/** Remove a single tab, ignoring errors if it's already closed. */
export function removeTab(tabId: number): void {
  chrome.tabs.remove(tabId).catch(() => {
    /* tab may already be closed */
  });
}

/** Close all tabs in the set and clear it. */
export async function closeOwnedTabs(tabIds: Set<number>): Promise<void> {
  for (const tabId of tabIds) {
    removeTab(tabId);
  }
  tabIds.clear();
}

/** Check that a tab still exists; call ctx.fail and return false if it does not. */
export async function assertRewardsTabExists(
  ctx: Context,
  rewardsTabId: number,
  phase: string,
): Promise<boolean> {
  const exists = await chrome.tabs.get(rewardsTabId).then(
    () => true,
    () => false,
  );
  if (!exists) {
    await ctx.fail('navigation', `Rewards tab no longer exists — cannot run ${phase}`);
    return false;
  }
  return true;
}
