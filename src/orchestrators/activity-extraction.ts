import { openTab } from '../util/tabs.js';
import { REWARDS_URL } from '../util/config.js';
import { MSG_ACTION } from '../util/messaging.js';
import type { AppMessage } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import { TIMEOUTS } from '../util/timing.js';
import { setState } from '../util/state.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { classifyCard, CardState, ACTIVITY_TYPE } from '../util/activity.js';
import type { RawCard, Activity, ExtractionResult } from '../util/activity.js';
import type { Context } from '../util/context.js';

function sumCompleted(activities: Activity[]): { count: number; points: number } {
  return activities.reduce(
    (acc, a) => {
      if (a.cardState === CardState.Completed) {
        acc.count++;
        acc.points += a.points;
      }
      return acc;
    },
    { count: 0, points: 0 },
  );
}

export class NotLoggedInError extends Error {
  constructor() {
    super('Not logged in');
  }
}

class ActivityExtractionOrchestrator extends OrchestratorBase {
  readonly name = 'Activity extraction';

  async run(ctx: Context): Promise<void> {
    this.checkStopped();

    let rewardsTab: chrome.tabs.Tab;
    try {
      rewardsTab = await openTab(REWARDS_URL, false);
    } catch {
      await ctx.fail('navigation', 'Failed to open rewards tab');
      await setState({ extractionResult: this.emptyResult(null) });
      return;
    }

    if (rewardsTab.id === undefined) throw new Error('Rewards tab has no ID');
    const rewardsTabId = rewardsTab.id;
    this.openedTabIds.add(rewardsTabId);

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

    await setState({ extractionResult: result });
  }

  private waitForExtraction(ctx: Context, rewardsTabId: number): Promise<ExtractionResult> {
    return new Promise<ExtractionResult>((resolve) => {
      const cleanup = () => {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onTabUpdated);
        chrome.runtime.onMessage.removeListener(onMessage);
      };

      const timeout = setTimeout(() => {
        cleanup();
        ctx.fail('navigation', 'Rewards page timed out — no activities extracted').catch(() => {});
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
          ctx.dbg(DBG.ERROR, `Not logged in — redirected to: ${tab.url}`).catch(() => {});
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
        }));

        const exploreActivities = allActivities.filter(
          (a) => a.activityType === ACTIVITY_TYPE.EXPLORE_ON_BING,
        );
        const dailyActivities = allActivities.filter(
          (a) => a.activityType === ACTIVITY_TYPE.DAILY_SET,
        );

        const exploreCompleted = sumCompleted(exploreActivities);
        const dailyCompleted = sumCompleted(dailyActivities);

        resolve({
          allActivities,
          loggedIn: true,
          rewardsTabId,
          alreadyCompletedCount: exploreCompleted.count,
          dailyAlreadyCompletedCount: dailyCompleted.count,
          alreadyCompletedPoints: exploreCompleted.points,
          dailyAlreadyCompletedPoints: dailyCompleted.points,
        });
      };

      chrome.tabs.onUpdated.addListener(onTabUpdated);
      chrome.runtime.onMessage.addListener(onMessage);
    });
  }

  private emptyResult(rewardsTabId: number | null): ExtractionResult {
    return {
      allActivities: [],
      loggedIn: true,
      rewardsTabId,
      alreadyCompletedCount: 0,
      dailyAlreadyCompletedCount: 0,
      alreadyCompletedPoints: 0,
      dailyAlreadyCompletedPoints: 0,
    };
  }
}

export { ActivityExtractionOrchestrator };
