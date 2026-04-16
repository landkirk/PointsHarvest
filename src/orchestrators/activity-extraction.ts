import { REWARDS_URL } from '../util/config.js';
import { MSG_ACTION } from '../util/messaging.js';
import type { AppMessage } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import { TIMEOUTS } from '../util/timing.js';
import { setRunState, loadRunState } from '../util/persistent-state.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { classifyCard, enrichSearchQueries, enrichUserActions } from '../util/activity.js';
import { ACTIVITY_TYPE } from '../util/activity-types.js';
import type { Activity, ActivityState } from '../util/activity-types.js';
import type { Context } from '../util/context.js';
import { FAIL } from '../util/failures.js';
import { NotLoggedInError } from '../util/errors.js';

class ActivityExtractionOrchestrator extends OrchestratorBase {
  readonly name = 'Activity extraction';

  async run(ctx: Context): Promise<void> {
    ctx.signal.throwIfAborted();

    const rewardsTabId = (await loadRunState()).rewardsTabId;
    if (!rewardsTabId) {
      await ctx.fail(FAIL.TAB, 'Rewards tab not open — cannot extract activities');
      await setRunState({ activityState: this.emptyResult(null) });
      return;
    }

    const result = await this.waitForExtraction(ctx, rewardsTabId);

    if (!result.loggedIn) throw new NotLoggedInError();

    const counts = { explore: 0, daily: 0, more: 0, ignored: 0 };
    for (const a of result.allActivities) {
      if (a.activityType === ACTIVITY_TYPE.EXPLORE_ON_BING) counts.explore++;
      else if (a.activityType === ACTIVITY_TYPE.DAILY_SET) counts.daily++;
      else if (a.activityType === ACTIVITY_TYPE.MORE_ACTIVITIES) counts.more++;
      else counts.ignored++;
    }
    await ctx.dbg(
      DBG.INFO,
      `Extracted ${result.allActivities.length} cards: ${counts.explore} explore, ${counts.daily} daily, ${counts.more} more activities, ${counts.ignored} ignored`,
    );

    await setRunState({ activityState: result });
  }

  private waitForExtraction(ctx: Context, rewardsTabId: number): Promise<ActivityState> {
    return new Promise<ActivityState>((resolve) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onTabUpdated);
        chrome.runtime.onMessage.removeListener(onMessage);
        ctx.signal.removeEventListener('abort', onAbort);
      };

      const settle = (result: ActivityState) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const timeout = setTimeout(async () => {
        await ctx.fail(FAIL.TAB, 'Rewards page timed out — no activities extracted');
        settle(this.emptyResult(rewardsTabId));
      }, TIMEOUTS.FETCH_ACTIVITIES);

      const onAbort = () => {
        settle(this.emptyResult(rewardsTabId));
      };

      const onTabUpdated = async (
        tabId: number,
        changeInfo: { status?: string },
        tab: chrome.tabs.Tab,
      ): Promise<void> => {
        if (tabId !== rewardsTabId || changeInfo.status !== 'complete' || !tab.url) return;
        if (tab.url.startsWith(REWARDS_URL)) {
          chrome.tabs.sendMessage(tabId, { action: MSG_ACTION.START_EXTRACT }).catch(() => {});
        } else {
          await ctx.fail(FAIL.AUTH, `Not logged in — redirected to: ${tab.url}`);
          settle({ ...this.emptyResult(rewardsTabId), loggedIn: false });
        }
      };

      const onMessage = (msg: AppMessage): undefined => {
        if (msg.action !== MSG_ACTION.ACTIVITIES_FOUND) return;

        if (msg.loggedIn === false) {
          settle({ ...this.emptyResult(rewardsTabId), loggedIn: false });
          return;
        }

        const allActivities: Activity[] = [];
        const exploreActivities: Activity[] = [];
        const dailyActivities: Activity[] = [];
        for (const card of msg.cards) {
          const activity: Activity = {
            id: card.id,
            title: card.title,
            description: card.description,
            points: card.points,
            cardState: card.cardState,
            activityType: classifyCard(card),
            requiresUserAction: false,
            userActionKind: null,
            userActionTimeoutMs: 0,
          };
          allActivities.push(activity);
          if (activity.activityType === ACTIVITY_TYPE.EXPLORE_ON_BING) {
            exploreActivities.push(activity);
          } else if (activity.activityType === ACTIVITY_TYPE.DAILY_SET) {
            dailyActivities.push(activity);
          }
        }

        enrichSearchQueries(exploreActivities);
        enrichUserActions(dailyActivities);

        settle({
          allActivities,
          loggedIn: true,
          rewardsTabId,
        });
      };

      ctx.signal.addEventListener('abort', onAbort, { once: true });
      chrome.tabs.onUpdated.addListener(onTabUpdated);
      chrome.runtime.onMessage.addListener(onMessage);
    });
  }

  private emptyResult(rewardsTabId: number | null): ActivityState {
    return {
      allActivities: [],
      loggedIn: true,
      rewardsTabId,
    };
  }
}

export { ActivityExtractionOrchestrator };
