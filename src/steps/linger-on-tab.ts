import { MSG_ACTION } from '../util/messaging.js';
import type { Context } from '../util/context.js';

// Waits for the user to complete a required action in the given tab.
// The promise resolves when the user either:
//   - clicks "Done" in the popup  (sends USER_ACTION_COMPLETE to background)
//   - closes the tab directly     (caught by chrome.tabs.onRemoved in background.js)
export async function run(ctx: Context, tabId: number): Promise<void> {
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    return; // tab already closed before we started waiting
  }
  ctx.session.lingerTabId = tabId;
  await ctx.setState({ isLingering: true });
  chrome.runtime.sendMessage({ action: MSG_ACTION.LINGER_WAITING }).catch(() => {});
  await new Promise<void>(resolve => { ctx.session.lingerResolve = resolve; });
  ctx.session.lingerTabId = null;
  await ctx.setState({ isLingering: false });
}
