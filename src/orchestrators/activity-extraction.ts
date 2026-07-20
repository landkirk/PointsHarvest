import { REWARDS_URL } from '../util/config.js';
import { MSG_ACTION } from '../util/messaging.js';
import type { ExtractResponse, RewardsStatusResponse } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import { TIMEOUTS, sleep } from '../util/timing.js';
import { setRunState, loadRunState } from '../util/persistent-state.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { classifyCard, enrichSearchQueries, enrichUserActions } from '../util/activity.js';
import { ACTIVITY_TYPE, SECTION } from '../util/activity-types.js';
import type { Activity, ActivityState, RawCard, SectionKey } from '../util/activity-types.js';
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

    let result = await this.waitForRewardsReady(ctx, rewardsTabId);

    if (!result.loggedIn) {
      await this._waitForUserAction(ctx, notLoggedInAction());
      ctx.signal.throwIfAborted();
      // Reload the rewards page to pick up the new login state
      try {
        await chrome.tabs.update(rewardsTabId, { url: REWARDS_URL });
      } catch {
        throw new NotLoggedInError(); // tab was closed
      }
      result = await this.waitForRewardsReady(ctx, rewardsTabId);
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

  /**
   * Wait until the rewards tab can answer for itself, then judge the session
   * and extract.
   *
   * Login is decided by polling the content script's REWARDS_STATUS probe — a
   * DOM heuristic, and now the authority (the dashboard API 401s even for live
   * sessions, so there is nothing to hold it against). A visible sign-in
   * control convicts immediately; a fully-loaded page showing none must hold
   * that answer across several consecutive probes before it counts, because
   * the header where the evidence renders can hydrate after readyState fires.
   */
  private async waitForRewardsReady(ctx: Context, rewardsTabId: number): Promise<ActivityState> {
    // The budget covers reaching the content script (page load included); the
    // first successful probe extends it once, so a slow load doesn't eat the
    // window the readiness confirmation needs.
    let deadline = Date.now() + TIMEOUTS.FETCH_ACTIVITIES;
    let probeReached = false;
    const CONFIRMATIONS_NEEDED = 3;
    let confirmations = 0;
    let offSiteSince: number | null = null;

    while (Date.now() < deadline) {
      if (ctx.signal.aborted) return this.emptyResult(rewardsTabId, true);

      const tab = await chrome.tabs.get(rewardsTabId).catch(() => null);
      if (!tab) {
        await ctx.fail(FAIL.TAB, 'Rewards tab closed while waiting for the page');
        return this.emptyResult(rewardsTabId, false);
      }

      if (tab.url && !tab.url.startsWith(REWARDS_URL)) {
        // Not proof of a dead session yet: sign-in flows bounce through auth
        // interstitials (login.live.com) that only later JS-redirect back to
        // rewards. Convict only if the tab stays off rewards.bing.com for the
        // whole grace window.
        offSiteSince ??= Date.now();
        confirmations = 0;
        if (Date.now() - offSiteSince >= TIMEOUTS.AUTH_REDIRECT_GRACE) {
          await ctx.fail(FAIL.AUTH, `Not logged in — redirected to: ${tab.url}`);
          return this.emptyResult(rewardsTabId, false);
        }
      } else {
        offSiteSince = null;
        const status = await this.probeStatus(rewardsTabId);
        if (status && !probeReached) {
          probeReached = true;
          deadline = Math.max(deadline, Date.now() + TIMEOUTS.REWARDS_EXTRACT_MAX_WAIT);
        }
        if (status?.domComplete) {
          if (status.loggedOutSignal) {
            await ctx.dbg(
              DBG.WARN,
              `Reported not logged in — DOM signal: ${status.loggedOutSignal}`,
            );
            return this.emptyResult(rewardsTabId, false);
          }
          confirmations++;
          if (confirmations >= CONFIRMATIONS_NEEDED) {
            return this.extractActivities(ctx, rewardsTabId);
          }
        } else {
          // Still loading, or the content script isn't injected yet.
          confirmations = 0;
        }
      }

      try {
        await sleep(TIMEOUTS.REWARDS_EXTRACT_POLL, ctx.signal);
      } catch {
        return this.emptyResult(rewardsTabId, true); // aborted mid-poll
      }
    }

    // Out of time without an answer. We cannot confirm a session, so we must
    // not claim one: zero cards + `loggedIn: true` renders as a cheerful "Done
    // for today!". Reporting logged-out prompts for sign-in and re-probes —
    // one dismissable prompt for a signed-in user, the truth for everyone else.
    await ctx.fail(FAIL.TAB, 'Rewards page timed out — could not confirm the session');
    return this.emptyResult(rewardsTabId, false);
  }

  /** One REWARDS_STATUS round trip; null means the content script isn't reachable yet. */
  private async probeStatus(rewardsTabId: number): Promise<RewardsStatusResponse | null> {
    try {
      const reply: unknown = await chrome.tabs.sendMessage(rewardsTabId, {
        action: MSG_ACTION.REWARDS_STATUS,
      });
      return (reply as RewardsStatusResponse | undefined) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Extract cards by reading the live DOM, section by section: navigate to the
   * section's page (daily set lives on `/`, the rest on `/earn`), expand it
   * (tiles unmount while collapsed), then have the content script parse its
   * tiles into RawCards. `ensureSectionReady` handles the page hop and lingers
   * for the SPA render, so the re-injected content script is answering by the
   * time the section is expanded.
   *
   * Phase rollout: "Keep earning" (moreActivities) lands next and until then
   * contributes zero cards, which its orchestrator already handles by skipping.
   */
  private async extractActivities(ctx: Context, rewardsTabId: number): Promise<ActivityState> {
    const cards: RawCard[] = [];
    for (const section of [SECTION.dailySet, SECTION.exploreOnBing]) {
      ctx.signal.throwIfAborted();
      if (!(await this.ensureSectionReady(ctx, rewardsTabId, section))) continue;
      const res = await this.extractSections(rewardsTabId, [section.key]);
      if (!res) {
        await ctx.fail(FAIL.TAB, `No extraction response for "${section.label}"`);
        continue;
      }
      for (const w of res.warnings) await ctx.dbg(DBG.WARN, `Extraction: ${w}`);
      await ctx.dbg(
        DBG.INFO,
        `Extracted ${res.cards.length} cards from "${section.label}" (${res.sectionTiles[section.key] ?? 0} tiles)`,
      );
      cards.push(...res.cards);
    }

    const allActivities: Activity[] = [];
    const exploreActivities: Activity[] = [];
    const dailyActivities: Activity[] = [];
    for (const card of cards) {
      const activity: Activity = {
        id: card.id,
        title: card.title,
        description: card.description,
        points: card.points,
        cardState: card.cardState,
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

    return { allActivities, loggedIn: true, rewardsTabId };
  }

  /** One EXTRACT_SECTIONS round trip; null when the content script is unreachable. */
  private async extractSections(
    rewardsTabId: number,
    sections: SectionKey[],
  ): Promise<ExtractResponse | null> {
    try {
      const reply: unknown = await chrome.tabs.sendMessage(rewardsTabId, {
        action: MSG_ACTION.EXTRACT_SECTIONS,
        sections,
      });
      return (reply as ExtractResponse | undefined) ?? null;
    } catch {
      return null;
    }
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
