// Opens each daily set activity in a background tab by index, dwells briefly, then closes.
// Activities matching quiz/poll/test/puzzle keywords linger until the user signals completion.

import { lingerOnPage } from '../util/timing.js';
import { ACTIVITY_TYPE } from '../util/activity.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { PHASE } from '../util/state.js';
import { lingerOnTab } from '../steps/linger-on-tab.js';
import { validateActivity, ValidationStatus } from '../steps/validate-activity.js';
import { fetchActivities } from '../steps/fetch-activities.js';
import type { Activity } from '../util/activity.js';

const USER_ACTION_RE = /\b(quiz|poll|test|puzzle)\b/i;
const POLL_TIMEOUT_MS = 2 * 60 * 1000; // 2 min — poll is a single click
const QUIZ_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — quiz/test/puzzle

class CompleteDailySets extends OrchestratorBase {
  readonly name = 'Daily sets';
  private lingerTabId: number | null = null;
  private lingerResolve: (() => void) | null = null;

  async run(ctx: Context): Promise<void> {
    this.checkStopped();
    const {
      dailySets,
      loggedIn,
      rewardsTabId,
      dailyAlreadyCompletedCount,
      dailyAlreadyCompletedPoints,
    } = await fetchActivities.run(ctx);
    if (!loggedIn) {
      await ctx.dbg(DBG.WARN, 'Daily sets: not logged in — skipping');
      return;
    }
    if (!rewardsTabId) return;

    this.openedTabIds.add(rewardsTabId);

    try {
      const dailyPhaseTotal = dailyAlreadyCompletedCount + dailySets.length;
      let earnedPts = dailyAlreadyCompletedPoints;
      await ctx.updateHeader({
        headerMessage: `Daily sets (${dailyAlreadyCompletedCount} / ${dailyPhaseTotal})`,
        activePhase: PHASE.DAILY,
        phaseProgress: { done: dailyAlreadyCompletedCount, total: dailyPhaseTotal },
        phasePoints: { daily: earnedPts },
      });
      if (dailySets.length === 0) {
        await ctx.dbg(DBG.INFO, 'No actionable daily set activities — skipping');
        return;
      }

      await ctx.dbg(DBG.INFO, `Starting daily sets: ${dailySets.length} activity/activities`);

      for (let i = 0; i < dailySets.length; i++) {
        this.checkStopped();

        const label = dailySets[i].title.slice(0, 60);
        await ctx.dbg(
          DBG.INFO,
          `[${dailySets[i].id}] [Daily set ${i + 1}/${dailySets.length}] Opening: "${label}"`,
        );

        const attempt = () => this.attemptActivity(ctx, rewardsTabId, dailySets[i]);
        const succeeded = await this.executeActivityWithValidation(ctx, attempt, attempt, {
          retryLogMessage: `Daily set activity ${i + 1} not validated — retrying`,
          lingerLabel: 'daily set activity retry',
          failCategory: 'validation',
          failMessage: `Daily set activity ${i + 1} still not validated after retry — skipping`,
          navFailMessage: `Failed to open tab for daily set activity ${i + 1}`,
          retryNavFailMessage: `Retry: failed to open tab for daily set activity ${i + 1}`,
        });
        if (!succeeded) continue;

        earnedPts += dailySets[i].points;
        this.checkStopped();
        await ctx.dbg(
          DBG.SUCCESS,
          `[${dailySets[i].id}] Daily set activity ${i + 1}/${dailySets.length} complete`,
        );
        await ctx.updateHeader({
          headerMessage: `Daily sets (${dailyAlreadyCompletedCount + i + 1} / ${dailyPhaseTotal})`,
          activePhase: PHASE.DAILY,
          phaseProgress: { done: dailyAlreadyCompletedCount + i + 1, total: dailyPhaseTotal },
          phasePoints: { daily: earnedPts },
        });

        if (i < dailySets.length - 1) {
          await lingerOnPage('between daily set activities');
          this.checkStopped();
        }
      }

      await ctx.updateHeader({
        headerMessage: `Daily sets (${dailyPhaseTotal} / ${dailyPhaseTotal})`,
        activePhase: PHASE.DAILY,
        phaseProgress: { done: dailyPhaseTotal, total: dailyPhaseTotal },
        phasePoints: { daily: earnedPts },
      });
      await ctx.dbg(DBG.SUCCESS, 'All daily set activities complete');
    } finally {
      if (rewardsTabId) this.closeTab(rewardsTabId);
    }
  }

  private async attemptActivity(
    ctx: Context,
    rewardsTabId: number,
    activity: Activity,
  ): Promise<boolean> {
    const { title, description } = activity;
    const label = title.slice(0, 60);
    const t = await this.clickCardAndCaptureTab(
      ctx,
      rewardsTabId,
      activity.id,
      label,
      ACTIVITY_TYPE.DAILY_SET,
    );
    if (!t) return false;

    this.checkStoppedOrCloseTab(t.id);

    if (USER_ACTION_RE.test(title) || USER_ACTION_RE.test(description)) {
      await ctx.dbg(DBG.INFO, 'User action required — waiting for completion');
      const isPoll = /\bpoll\b/i.test(title) || /\bpoll\b/i.test(description);
      await lingerOnTab.run(ctx, t.id, {
        onResolve: (r) => {
          this.lingerResolve = r;
        },
        onTabId: (id) => {
          this.lingerTabId = id;
        },
        timeoutMs: isPoll ? POLL_TIMEOUT_MS : QUIZ_TIMEOUT_MS,
      });
    } else {
      await lingerOnPage('daily set activity');
      this.checkStoppedOrCloseTab(t.id);
      this.closeTab(t.id);
    }
    this.checkStopped();
    const validated = await validateActivity.run(ctx, activity, rewardsTabId);
    return validated.status !== ValidationStatus.Incomplete;
  }

  private _resolveLinger(closeTab: boolean): void {
    if (!this.lingerResolve) return;
    const resolve = this.lingerResolve;
    this.lingerResolve = null;
    if (this.lingerTabId) {
      if (closeTab) this.closeTab(this.lingerTabId);
      else this.openedTabIds.delete(this.lingerTabId);
      this.lingerTabId = null;
    }
    resolve();
  }

  onTabRemoved(tabId: number): void {
    if (tabId === this.lingerTabId) this._resolveLinger(false);
  }

  onUserActionComplete(): void {
    this._resolveLinger(true);
  }

  protected async _onStop(_ctx: Context): Promise<void> {
    this._resolveLinger(true);
  }
}

export { CompleteDailySets };
