import { REWARDS_URL } from '../util/config.js';
import { MSG_ACTION } from '../util/messaging.js';
import type { AppMessage } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import { TIMEOUTS } from '../util/timing.js';
import { setRunState, loadRunState } from '../util/persistent-state.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import {
  classifyCard,
  ACTIVITY_TYPE,
  enrichSearchQueries,
  enrichUserActions,
} from '../util/activity.js';
import type { RawCard, Activity, ActivityState } from '../util/activity.js';
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

    const explore = result.allActivities.filter(
      (a) => a.activityType === ACTIVITY_TYPE.EXPLORE_ON_BING,
    ).length;
    const daily = result.allActivities.filter(
      (a) => a.activityType === ACTIVITY_TYPE.DAILY_SET,
    ).length;
    const ignored = result.allActivities.length - explore - daily;
    await ctx.dbg(
      DBG.INFO,
      `Extracted ${result.allActivities.length} cards: ${explore} explore, ${daily} daily, ${ignored} ignored`,
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

        const allActivities: Activity[] = msg.cards.map((card: RawCard) => ({
          id: card.id,
          title: card.title,
          description: card.description,
          points: card.points,
          cardState: card.cardState,
          activityType: classifyCard(card),
          requiresUserAction: false,
          userActionKind: null,
          userActionTimeoutMs: 0,
        }));

        const exploreActivities = allActivities.filter(
          (a) => a.activityType === ACTIVITY_TYPE.EXPLORE_ON_BING,
        );
        const dailyActivities = allActivities.filter(
          (a) => a.activityType === ACTIVITY_TYPE.DAILY_SET,
        );

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
