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
import { notLoggedInAction } from '../steps/wait-for-user-action.js';

class ActivityExtractionOrchestrator extends OrchestratorBase {
  readonly name = 'Activity extraction';

  async run(ctx: Context): Promise<void> {
    ctx.signal.throwIfAborted();

    const rewardsTabId = (await loadRunState()).rewardsTabId;
    if (!rewardsTabId) {
      await ctx.fail(FAIL.TAB, 'Rewards tab not open — cannot extract activities');
      await setRunState({ activityState: this.emptyResult(null, true) });
      return;
    }

    let result = await this.waitForExtraction(ctx, rewardsTabId);

    if (!result.loggedIn) {
      await this._waitForUserAction(ctx, notLoggedInAction());
      ctx.signal.throwIfAborted();
      // Reload the rewards page to pick up the new login state
      try {
        await chrome.tabs.update(rewardsTabId, { url: REWARDS_URL });
      } catch {
        throw new NotLoggedInError(); // tab was closed
      }
      result = await this.waitForExtraction(ctx, rewardsTabId);
      if (!result.loggedIn) throw new NotLoggedInError();
    }

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
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let redirectGrace: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        clearTimeout(timeout);
        clearTimeout(redirectGrace);
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

      const armTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
          await ctx.fail(FAIL.TAB, 'Rewards page timed out — no activities extracted');
          // An unreadable dashboard is not evidence of a session, so we must not
          // claim one: zero cards + `loggedIn: true` renders as a cheerful "Done
          // for today!". Reporting logged-out prompts for sign-in and re-extracts
          // — one dismissable prompt for a signed-in user, the truth for everyone
          // else. (Abort is the exception below: a stopped run must not prompt.)
          settle(this.emptyResult(rewardsTabId, false));
        }, TIMEOUTS.FETCH_ACTIVITIES);
      };

      // Backstop for a page that never finishes loading; re-armed on START_EXTRACT.
      armTimeout();

      const onAbort = () => {
        settle(this.emptyResult(rewardsTabId, true));
      };

      const onTabUpdated = async (
        tabId: number,
        changeInfo: { status?: string },
        tab: chrome.tabs.Tab,
      ): Promise<void> => {
        if (tabId !== rewardsTabId || changeInfo.status !== 'complete' || !tab.url) return;
        if (tab.url.startsWith(REWARDS_URL)) {
          // Any pending "redirected away" verdict is void — the tab came back.
          clearTimeout(redirectGrace);
          redirectGrace = undefined;
          // Restart the budget here, not at tab creation. The content script's own
          // clock (REWARDS_EXTRACT_MAX_WAIT, 15s) starts on this event, so a
          // deadline measured from tab creation spends the page's whole load time
          // out of that window and times out a reply that was still coming —
          // settling empty while extraction was still working.
          armTimeout();
          chrome.tabs.sendMessage(tabId, { action: MSG_ACTION.START_EXTRACT }).catch(() => {});
        } else {
          // Not proof of a dead session yet: sign-in flows bounce through auth
          // interstitials (login.live.com) that reach 'complete' and only then
          // JS-redirect back to rewards. Convict only if the tab is still off
          // rewards.bing.com when the grace window expires.
          if (redirectGrace !== undefined) return; // verdict already pending
          const seenUrl = tab.url;
          redirectGrace = setTimeout(async () => {
            if (settled) return;
            const current = await chrome.tabs.get(rewardsTabId).catch(() => null);
            if (current?.url?.startsWith(REWARDS_URL)) return; // bounced back — extraction is proceeding
            await ctx.fail(FAIL.AUTH, `Not logged in — redirected to: ${current?.url ?? seenUrl}`);
            settle(this.emptyResult(rewardsTabId, false));
          }, TIMEOUTS.AUTH_REDIRECT_GRACE);
        }
      };

      const onMessage = (msg: AppMessage): undefined => {
        if (msg.action !== MSG_ACTION.ACTIVITIES_FOUND) return;

        if (msg.loggedIn === false) {
          void ctx.dbg(DBG.WARN, `Reported not logged in — ${msg.reason ?? 'no reason given'}`);
          settle(this.emptyResult(rewardsTabId, false));
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
            promoName: card.promoName,
            destinationUrl: card.destinationUrl,
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

  /**
   * A no-data result. `loggedIn` is required so every call site states its
   * session claim explicitly: `true` suppresses the sign-in prompt (what an
   * aborted run wants — it is not a claim about the session), while any caller
   * that settles because the dashboard could not be read must pass `false`, or
   * the run reports "Done for today!" to someone who earned nothing.
   */
  private emptyResult(rewardsTabId: number | null, loggedIn: boolean): ActivityState {
    return {
      allActivities: [],
      loggedIn,
      rewardsTabId,
    };
  }
}

export { ActivityExtractionOrchestrator };
