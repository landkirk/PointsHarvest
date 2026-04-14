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

export { NotLoggedInError };

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
      const cleanup = () => {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onTabUpdated);
        chrome.runtime.onMessage.removeListener(onMessage);
      };

      const timeout = setTimeout(async () => {
        cleanup();
        await ctx.fail(FAIL.TAB, 'Rewards page timed out — no activities extracted');
        resolve(this.emptyResult(rewardsTabId));
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
          void ctx.fail(FAIL.AUTH, `Not logged in — redirected to: ${tab.url}`);
          cleanup();
          resolve({ ...this.emptyResult(rewardsTabId), loggedIn: false });
        }
      };

      const onMessage = (msg: AppMessage): undefined => {
        if (msg.action !== MSG_ACTION.ACTIVITIES_FOUND) return;
        cleanup();

        if (msg.loggedIn === false) {
          resolve({ ...this.emptyResult(rewardsTabId), loggedIn: false });
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

        resolve({
          allActivities,
          loggedIn: true,
          rewardsTabId,
        });
      };

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
