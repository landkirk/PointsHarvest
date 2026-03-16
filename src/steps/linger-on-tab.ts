import { MSG_ACTION } from '../util/messaging.js';
import type { Context } from '../util/context.js';

export interface LingerHooks {
  onResolve: (resolve: () => void) => void;
  onTabId:   (tabId: number | null) => void;
}

// Waits for the user to complete a required action in the given tab.
// The promise resolves when the user either:
//   - clicks "Done" in the popup  (sends USER_ACTION_COMPLETE to background)
//   - closes the tab directly     (caught by chrome.tabs.onRemoved in background.js)
export async function run(ctx: Context, tabId: number, hooks: LingerHooks): Promise<void> {
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    return; // tab already closed before we started waiting
  }
  hooks.onTabId(tabId);
  await ctx.setState({ isLingering: true });
  chrome.runtime.sendMessage({ action: MSG_ACTION.LINGER_WAITING }).catch(() => {});
  await new Promise<void>(resolve => { hooks.onResolve(resolve); });
  hooks.onTabId(null);
  await ctx.setState({ isLingering: false });
}
