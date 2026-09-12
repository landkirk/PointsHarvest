// Opens each daily set activity in a background tab by index, dwells briefly, then closes.
// Activities matching quiz/poll/test/puzzle keywords linger until the user signals completion.

import { LABEL_MAX, pluralize, truncate } from '../util/format.js';
import { sumCompleted } from '../util/activity.js';
import { ACTIVITY_TYPE, CardState, SECTION } from '../util/activity-types.js';
import type { Activity, UserActionKind } from '../util/activity-types.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { executeWithRetry } from '../util/execute-with-retry.js';
import { FAIL } from '../util/failures.js';
import { loadPreferences, loadRunState } from '../util/persistent-state.js';
import { PHASE } from '../util/phase.js';
import { lingerOnPage } from '../util/timing.js';
import { lingerOnTab, type LingerHandle } from '../steps/linger-on-tab.js';
import { autoAnswerQuiz, AutoAnswerStatus } from '../steps/auto-answer-quiz.js';
import { validateActivity, ValidationStatus } from '../steps/validate-activity.js';
import { TabCaptureStatus } from '../util/tab-manager.js';
import { runActivityLoop } from '../util/run-activity-loop.js';

/**
 * The kinds auto-answer will play. Puzzles are excluded deliberately: picking an
 * arbitrary option can't solve one, so they keep prompting the user.
 */
const AUTO_ANSWERABLE = new Set<UserActionKind | null>(['quiz', 'poll']);

class CompleteDailySets extends OrchestratorBase {
  readonly name = 'Daily sets';
  private currentLinger: LingerHandle | null = null;
  /** Read once per phase — the preference can't change mid-run. */
  private autoAnswer = false;

  async run(ctx: Context): Promise<void> {
    ctx.signal.throwIfAborted();
    const [prefs, run] = await Promise.all([loadPreferences(), loadRunState()]);
    this.autoAnswer = prefs.autoAnswerQuizzes;
    const extraction = run.activityState ?? null;
    if (!extraction || !extraction.rewardsTabId) {
      await ctx.dbg(DBG.WARN, 'No extraction result — skipping daily sets');
      return;
    }

    const { rewardsTabId } = extraction;
    const allDaily = extraction.allActivities.filter(
      (a) => a.activityType === ACTIVITY_TYPE.DAILY_SET,
    );
    const { count: alreadyCompletedCount, points: alreadyCompletedPoints } = sumCompleted(allDaily);

    if (!(await this.tabs.assertTabExists(ctx, rewardsTabId, 'daily sets'))) return;

    const dailySets = allDaily.filter((a) => a.cardState === CardState.Actionable);

    if (dailySets.length === 0) {
      await ctx.dbg(DBG.INFO, 'No actionable daily set activities — skipping');
    } else {
      await ctx.dbg(
        DBG.INFO,
        `Starting daily sets: ${dailySets.length} ${pluralize(dailySets.length, 'activity', 'activities')}`,
      );
      if (!(await this.ensureSectionReady(ctx, rewardsTabId, SECTION.dailySet))) return;
    }

    await runActivityLoop({
      ctx,
      phase: PHASE.DAILY,
      activities: dailySets,
      alreadyCompletedCount,
      alreadyCompletedPoints,
      lingerLabel: 'between daily set activities',
      statusLine: (a) => `Opening: "${truncate(a.title, LABEL_MAX)}"`,
      attempt: async (a, i) =>
        executeWithRetry(
          ctx,
          () => this.attemptActivity(ctx, rewardsTabId, a),
          {
            maxAttempts: 2,
            retryLogMessage: `Daily set activity ${i + 1} not validated — retrying`,
            lingerLabel: 'daily set activity retry',
          },
          {
            category: FAIL.VALIDATION,
            message: `Daily set activity ${i + 1} still not validated after retry — skipping`,
          },
        ),
    });
  }

  private async attemptActivity(
    ctx: Context,
    rewardsTabId: number,
    activity: Activity,
  ): Promise<boolean> {
    const { title } = activity;
    const result = await this.tabs.clickCardAndCaptureTab(ctx, rewardsTabId, activity);
    if (result.status === TabCaptureStatus.Failed) return false;
    if (result.status === TabCaptureStatus.Blocked) {
      await this._waitForPopupUnblock(ctx, title);
      return false;
    }
    const t = result.tab;

    ctx.signal.throwIfAborted();

    // Auto-answer is opt-in and covers quizzes/polls only — a puzzle needs real
    // input that can't be guessed. An unrecognised page falls through to the
    // prompt below, so the preference can save work but never costs points.
    const needsUser =
      activity.requiresUserAction &&
      !(
        this.autoAnswer &&
        AUTO_ANSWERABLE.has(activity.userActionKind) &&
        (await autoAnswerQuiz._run(ctx, t.id, activity, this.tabs)) !== AutoAnswerStatus.Unsupported
      );

    if (needsUser) {
      await ctx.dbg(DBG.INFO, 'User action required — waiting for completion');
      const linger = lingerOnTab(ctx, t.id, activity);
      this.currentLinger = linger;
      await linger.promise;
      this.currentLinger = null;
    } else {
      // An auto-answered quiz's final answer is an anchor to another SERP, and the
      // activity credits on *that* load landing — so, like every other crediting
      // path here, dwell before closing rather than killing the navigation.
      await lingerOnPage('daily set activity', undefined, ctx.signal);
      ctx.signal.throwIfAborted();
      await this.tabs.closeTabWithChildren(t.id);
    }
    ctx.signal.throwIfAborted();
    const validated = await validateActivity._run(ctx, activity, rewardsTabId, this.tabs);
    return validated.status === ValidationStatus.Completed;
  }

  private _resolveLinger(closeTab: boolean): void {
    if (!this.currentLinger) return;
    const linger = this.currentLinger;
    this.currentLinger = null;
    if (closeTab) void this.tabs.closeTabWithChildren(linger.tabId);
    else this.tabs.untrackTab(linger.tabId);
    linger.resolve();
  }

  override onTabRemoved(tabId: number): void {
    if (this.currentLinger?.tabId === tabId) this._resolveLinger(false);
  }

  override onUserActionComplete(): void {
    super.onUserActionComplete();
    this._resolveLinger(true);
  }

  protected override async _onStop(_ctx: Context): Promise<void> {
    await super._onStop(_ctx);
    this._resolveLinger(true);
  }
}

export { CompleteDailySets };
