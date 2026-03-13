import { MSG_ACTION } from '../util/config.js';
import { state } from '../state.js';

// lingerOnTab(tabId)
//
// Waits for the user to complete a required action in the given tab.
// The promise resolves when the user either:
//   - clicks "Done" in the popup  (sends USER_ACTION_COMPLETE to background)
//   - closes the tab directly     (caught by chrome.tabs.onRemoved in background.js)
//
// Tile objects can opt into this behavior by setting requiresUserAction: true.
// The caller is responsible for opening the tab and passing its tabId here.
export async function lingerOnTab(tabId) {
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    return; // tab already closed before we started waiting
  }
  state.lingerTabId = tabId;
  chrome.runtime.sendMessage({ action: MSG_ACTION.LINGER_WAITING }).catch(() => {});
  await new Promise(resolve => { state.lingerResolve = resolve; });
  state.lingerTabId = null;
}
