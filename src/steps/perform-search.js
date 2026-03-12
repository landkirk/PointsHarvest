// Responsible for completing a search activity in a Bing tab opened by a card click.
// The tab is already loaded at https://www.bing.com/?form=... when this is called.

import { dbg, randMs, sleep } from '../util/debug.js';
import { MSG_ACTION } from '../util/config.js';

export async function performSearchInTab(tabId, query) {
  const preDwell = randMs(1000, 3000);
  await dbg('info', `Pre-search dwell ${(preDwell / 1000).toFixed(1)}s`);
  await sleep(preDwell);

  const result = await chrome.tabs.sendMessage(tabId, { action: MSG_ACTION.PERFORM_SEARCH, query })
    .catch(() => null);

  if (!result?.ok) {
    await dbg('warn', `Search input failed for "${query}": ${result?.error ?? 'no response'}`);
  }

  // Dwell on the (now-navigating) search results page.
  const dwell = randMs(1000, 3000);
  await dbg('info', `Dwell ${(dwell / 1000).toFixed(1)}s after search: "${query}"`);
  await sleep(dwell);
}
