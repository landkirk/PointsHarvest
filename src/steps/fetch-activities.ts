// Opens the rewards dashboard and waits for the content script to resolve activities.

import { openTab } from '../util/tabs.js';
import { REWARDS_URL } from '../util/config.js';
import { MSG_ACTION } from '../util/messaging.js';
import type { AppMessage } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import { TIMEOUTS } from '../util/timing.js';
import { setDebugState } from '../util/state.js';
import { StepBase } from '../interfaces/step.js';
import type { Context } from '../util/context.js';
import type { ActivitiesResult } from '../util/activity.js';
import type { ActivityScan } from '../util/debug.js';

export type FetchActivitiesResult = ActivitiesResult & { rewardsTabId: number | null };

export class NotLoggedInError extends Error {
  constructor() {
    super('Not logged in');
  }
}

const EMPTY_ACTIVITIES: ActivitiesResult = { activities: [], dailySets: [], loggedIn: true };

class FetchActivitiesStep extends StepBase<[], FetchActivitiesResult> {
  readonly name = 'fetch-activities';

  async run(ctx: Context): Promise<FetchActivitiesResult> {
    let resolveLocal!: (result: ActivitiesResult) => void;
    const activitiesPromise = new Promise<ActivitiesResult>((resolve) => {
      resolveLocal = resolve;
    });

    let rewardsTab: chrome.tabs.Tab;
    try {
      rewardsTab = await openTab(REWARDS_URL, false);
    } catch {
      await ctx.fail('navigation', 'Failed to open rewards tab');
      return { ...EMPTY_ACTIVITIES, rewardsTabId: null };
    }

    const rewardsTabId = rewardsTab.id!;

    function cleanup(): void {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      chrome.runtime.onMessage.removeListener(onMessage);
    }

    const timeout = setTimeout(() => {
      cleanup();
      ctx.fail('navigation', 'Rewards page timed out — no activities extracted').catch(() => {});
      resolveLocal(EMPTY_ACTIVITIES);
    }, TIMEOUTS.FETCH_ACTIVITIES);

    const onTabUpdated = (
      tabId: number,
      changeInfo: { status?: string },
      tab: chrome.tabs.Tab,
    ): void => {
      if (tabId !== rewardsTabId || changeInfo.status !== 'complete' || !tab.url) return;
      if (tab.url.startsWith(REWARDS_URL)) {
        chrome.tabs.sendMessage(tabId, { action: MSG_ACTION.START_EXTRACT }).catch(() => {});
      } else {
        ctx.dbg(DBG.ERROR, `Not logged in — redirected to: ${tab.url}`);
        cleanup();
        resolveLocal({ ...EMPTY_ACTIVITIES, loggedIn: false });
      }
    };

    const onMessage = (msg: AppMessage): undefined => {
      if (msg.action !== MSG_ACTION.ACTIVITIES_FOUND) return;
      cleanup();
      setDebugState({
        domDebug: (msg.domDebug ?? null) as ActivityScan | null,
        dailySetDebug: (msg.dailySetDebug ?? null) as ActivityScan | null,
      }).catch(() => {});
      resolveLocal({
        activities: msg.activities,
        dailySets: msg.dailySets ?? [],
        loggedIn: msg.loggedIn !== false,
      });
    };

    chrome.tabs.onUpdated.addListener(onTabUpdated);
    chrome.runtime.onMessage.addListener(onMessage);

    try {
      const result = await activitiesPromise;
      return { ...result, rewardsTabId };
    } finally {
      cleanup();
    }
  }
}

export const fetchActivities = new FetchActivitiesStep();
