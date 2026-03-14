// Polls the dedicated breakdown tab for search point counters.
// Polling runs in the background service worker (not the tab) to avoid
// Chrome's background-tab timer throttling.

import { session, setState } from '../util/state.js';
import { dbg } from '../util/debug.js';
import { sleep } from '../util/timing.js';
import { MSG_ACTION } from '../util/config.js';

const POLL_INTERVAL_MS = 1000;
const MAX_POLLS        = 20;

export async function fetchSearchCounters() {
  if (!session.breakdownTabId) {
    await dbg('warn', 'fetchSearchCounters: no breakdown tab open');
    return { searchCounters: [], searchCounterDebug: null };
  }

  for (let i = 0; i < MAX_POLLS; i++) {
    const result = await chrome.tabs.sendMessage(session.breakdownTabId, { action: MSG_ACTION.GET_COUNTERS })
      .catch(() => null);

    if (result?.searchCounters?.length > 0) {
      await setState({ searchCounters: result.searchCounters, searchCounterDebug: result.searchCounterDebug });
      await dbg('info', `Search counters: ${result.searchCounters.map(c => `${c.type}: ${c.current}/${c.max}`).join(', ')}`);
      return result;
    }

    if (i < MAX_POLLS - 1) await sleep(POLL_INTERVAL_MS);
  }

  await dbg('warn', `Counter fetch timed out after ${MAX_POLLS}s`);
  return { searchCounters: [], searchCounterDebug: null };
}
