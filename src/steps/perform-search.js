// Responsible for completing a search activity in a Bing tab opened by a card click.
// The tab is already loaded at https://www.bing.com/?form=... when this is called.

import { lingerOnPage } from '../util/timing.js';
import { MSG_ACTION } from '../util/config.js';

export async function run(ctx, tabId, query) {
  await lingerOnPage('search tab');

  const result = await chrome.tabs.sendMessage(tabId, { action: MSG_ACTION.PERFORM_SEARCH, query })
    .catch(() => null);

  if (!result?.ok) {
    await ctx.dbg('warn', `Search input failed for "${query}": ${result?.error ?? 'no response'}`);
  }

  await lingerOnPage(`results: "${query}"`);
}
