// Opens the rewards dashboard and waits for the content script to resolve activities.

import { closeRewardsTab, openTab } from '../util/tabs.js';
import { REWARDS_URL } from '../util/config.js';
import type { Context } from '../util/context.js';
import type { ActivitiesResult } from '../util/state.js';

export class NotLoggedInError extends Error {
  constructor() { super('Not logged in'); }
}

export async function run(ctx: Context): Promise<ActivitiesResult> {
  let resolveLocal!: (result: ActivitiesResult) => void;
  const result = new Promise<ActivitiesResult>(resolve => { resolveLocal = resolve; });

  const timeout = setTimeout(() => {
    ctx.session.resolveActivities = null;
    closeRewardsTab();
    ctx.dbg('warn', 'Rewards page timed out — no activities');
    resolveLocal({ activities: [], domDebug: null, dailySets: [], dailySetDebug: null, loggedIn: true });
  }, 20000);

  let rewardsTab: chrome.tabs.Tab;
  try {
    rewardsTab = await openTab(REWARDS_URL, false);
  } catch {
    clearTimeout(timeout);
    ctx.session.resolveActivities = null;
    ctx.dbg('error', 'Failed to open rewards tab');
    resolveLocal({ activities: [], domDebug: null, dailySets: [], dailySetDebug: null, loggedIn: true });
    return result;
  }

  ctx.session.rewardsTabId = rewardsTab.id!;

  // Rewards tab stays open after resolving — the calling orchestrator owns it and will close it.
  ctx.session.resolveActivities = ({ activities = [], domDebug = null, dailySets = [], dailySetDebug = null, loggedIn = true }: Partial<ActivitiesResult> = {}) => {
    clearTimeout(timeout);
    resolveLocal({ activities, domDebug, dailySets, dailySetDebug, loggedIn });
  };

  return result;
}
