import { setHeaderState } from '../util/state.js';
import { StepBase } from '../interfaces/step.js';
import type { Context } from '../util/context.js';

export interface LingerHooks {
  onResolve: (resolve: () => void) => void;
  onTabId: (tabId: number | null) => void;
  timeoutMs: number;
}

// Waits for the user to complete a required action in the given tab.
// The promise resolves when the user either:
//   - clicks "Done" in the popup  (sends USER_ACTION_COMPLETE to background)
//   - closes the tab directly     (caught by chrome.tabs.onRemoved in background.js)
class LingerOnTabStep extends StepBase<[number, LingerHooks]> {
  readonly name = 'linger-on-tab';

  async run(ctx: Context, tabId: number, hooks: LingerHooks): Promise<void> {
    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch {
      return; // tab already closed before we started waiting
    }
    hooks.onTabId(tabId);
    await ctx.setState({ isLingering: true });
    await setHeaderState({ headerMessage: 'Action required — complete the activity in the tab' });
    await ctx.broadcastProgress();
    await Promise.race([
      new Promise<void>((resolve) => {
        hooks.onResolve(resolve);
      }),
      new Promise<void>((resolve) => setTimeout(resolve, hooks.timeoutMs)),
    ]);
    hooks.onTabId(null);
    await ctx.setState({ isLingering: false });
    await setHeaderState({ headerMessage: 'Resuming…' });
    await ctx.broadcastProgress();
  }
}

export const lingerOnTab = new LingerOnTabStep();
