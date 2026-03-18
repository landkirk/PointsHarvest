// Responsible for completing a search activity in a Bing tab opened by a card click.
// The tab is already loaded at https://www.bing.com/?form=... when this is called.

import { lingerOnPage, TIMING } from '../util/timing.js';
import { MSG_ACTION } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import { StepBase } from '../interfaces/step.js';
import type { Context } from '../util/context.js';

class PerformSearchStep extends StepBase<[number, string]> {
  readonly name = 'perform-search';

  async run(ctx: Context, tabId: number, query: string): Promise<void> {
    await lingerOnPage('search tab', TIMING.LINGER_ON_SEARCH);
    this.checkStopped();

    const result = await chrome.tabs.sendMessage(tabId, { action: MSG_ACTION.PERFORM_SEARCH, query })
      .catch(() => null);
    this.checkStopped();

    if (!result?.ok) {
      await ctx.dbg(DBG.WARN, `Search input failed for "${query}": ${result?.error ?? 'no response'}`);
    }

    await lingerOnPage(`results: "${query}"`);
  }
}

export const performSearch = new PerformSearchStep();
