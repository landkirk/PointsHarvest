// Plays a daily-set quiz or poll unattended: pick an option, click it through
// the trusted CDP path, wait for whatever comes next, repeat.
//
// Quizzes and polls are one flow here — same step, same LOCATE_QUIZ_OPTION
// message, same click path. Only their markup differs, and that difference lives
// entirely in the MODULES table in content/quiz-dom.ts. The one behavioural
// split is length: a quiz walks several questions, a poll is a single vote.
//
// Answering *navigates* the tab (each option is a real anchor to another SERP
// URL), so every round re-locates from scratch rather than holding element
// references, and a rejected sendMessage mid-navigation is a "keep polling"
// signal, not a failure — the same convention the REWARDS_STATUS readiness
// probe uses.
//
// Not every family goes straight to the next question, either. The `.btq_main`
// quiz lands on an answer reveal — the correct choice, an explanation, "34% got
// this right" — with the next question rendered but hidden behind a "Next"
// button. So a round here is answer → reveal → advance, and the loop treats
// those two clicks differently: an advance costs no round, and nothing on the
// page distinguishes before from after it (the reveal already labels itself with
// the *coming* question's "2/3"), so the stale-read guard is switched off for
// the wait that follows one.
//
// This step never decides an activity failed. It stops and lets the existing
// validateActivity read the dashboard tile, which is the only real arbiter of
// whether the points landed.

import { DBG } from '../util/debug.js';
import { LOCATE_STATUS, QUIZ_MOVE } from '../util/messaging.js';
import { randMs, sleep, TIMEOUTS, TIMING } from '../util/timing.js';
import { StepBase } from '../interfaces/step.js';
import { LABEL_MAX, truncate } from '../util/format.js';

import type { Activity } from '../util/activity-types.js';
import type { Context } from '../util/context.js';
import type { QuizProgress } from '../util/messaging.js';
import type { TabManager } from '../util/tab-manager.js';

/** The round just answered, for telling the next question apart from a stale read. */
interface AnsweredRound {
  progress: QuizProgress | null;
  question: string | null;
}

/**
 * Has the page moved on from the question we just answered?
 *
 * Answering navigates, and a probe can land before the new document commits, so
 * a clickable option on its own proves nothing. Compare whatever both readings
 * carry — progress first, then question text — and only when neither is
 * comparable fall back to trusting the reading.
 *
 * A null `answered` means there is nothing to compare against on purpose: after
 * a "Next" click the reveal we just left was already reporting the question that
 * is now on screen, so every comparable field reads identical across the click
 * and any answerable question counts as the new round.
 */
function isNewRound(
  answered: AnsweredRound | null,
  progress: QuizProgress | null,
  question: string | null,
): boolean {
  if (!answered) return true;
  if (answered.progress && progress) return progress.current !== answered.progress.current;
  if (answered.question && question) return question !== answered.question;
  return true;
}

export const enum AutoAnswerStatus {
  /** Answered to the end (or the module went away mid-run). */
  Completed = 'completed',
  /** No module we recognize — the caller should fall back to asking the user. */
  Unsupported = 'unsupported',
}

class AutoAnswerQuizStep extends StepBase<[number, Activity, TabManager], AutoAnswerStatus> {
  readonly name = 'auto-answer-quiz';

  async run(
    ctx: Context,
    tabId: number,
    activity: Activity,
    tabs: TabManager,
  ): Promise<AutoAnswerStatus> {
    const label = `${activity.userActionKind ?? 'activity'} "${truncate(activity.title, LABEL_MAX)}"`;
    let rounds = 0;
    // "Next" clicks. Capped separately because they answer nothing: a control
    // that reappears without advancing would otherwise spin here forever, and
    // the answer cap can't catch it.
    let advances = 0;
    let cap = TIMEOUTS.QUIZ_MAX_ROUNDS;

    while (rounds < cap && advances < TIMEOUTS.QUIZ_MAX_ROUNDS) {
      ctx.signal.throwIfAborted();

      // Nothing clicked yet: the hand-it-back guards below are only right while
      // the page is still untouched. Once we have answered *or* advanced, the
      // same readings mean the quiz ended rather than that it was never ours.
      const untouched = rounds === 0 && advances === 0;

      // Read the question — or the answer reveal — before clicking, as a person
      // would. Multiplier-scaled, so Slow/Stealth stretch it along with
      // everything else.
      await sleep(randMs(...TIMING.QUIZ_ANSWER_DWELL), ctx.signal);
      ctx.signal.throwIfAborted();

      const { ok, error, res } = await tabs.clickQuizOption(tabId, label);

      if (res?.status === LOCATE_STATUS.Absent) {
        // Round 1: this was never a quiz page we understand — hand it back.
        if (untouched) {
          await ctx.dbg(DBG.WARN, `No quiz module found for ${label} — asking the user instead`);
          return AutoAnswerStatus.Unsupported;
        }
        // Later: the module is gone after the final answer. Normal completion.
        await ctx.dbg(DBG.INFO, `Quiz module gone after ${rounds} answer(s) — ${label}`);
        return AutoAnswerStatus.Completed;
      }

      if (res?.status === LOCATE_STATUS.Satisfied) {
        // Round 1: only positive played evidence counts as "already done". A
        // parse miss — markup this build doesn't understand — has to go back to
        // the user; silently reporting it complete would cost exactly the points
        // the fallback exists to protect.
        if (untouched && res.state === 'unparsed') {
          await ctx.dbg(
            DBG.WARN,
            `Quiz module has no readable options (${res.via}) for ${label} — asking the user instead`,
          );
          return AutoAnswerStatus.Unsupported;
        }
        await ctx.dbg(DBG.INFO, `Quiz finished after ${rounds} answer(s) — ${label}`);
        return AutoAnswerStatus.Completed;
      }

      if (!ok || res?.status !== LOCATE_STATUS.Ready) {
        // The tab went away, or CDP refused. Nothing more to do here; the tile
        // read decides the outcome.
        await ctx.dbg(DBG.WARN, `Quiz answer click failed — ${error ?? 'unknown'}`);
        return untouched ? AutoAnswerStatus.Unsupported : AutoAnswerStatus.Completed;
      }

      const progress = res.progress;
      if (progress) cap = Math.min(TIMEOUTS.QUIZ_MAX_ROUNDS, progress.total);

      // What we just clicked was the reveal's "Next", not an answer. Nothing was
      // answered, so this is not a round — wait for the question it uncovers and
      // go again. The wait gets no `answered` snapshot to compare against: the
      // reveal was already labelled with the question now appearing.
      if (res.move === QUIZ_MOVE.Advance) {
        advances++;
        await ctx.dbg(DBG.INFO, `Advanced past the answer reveal via ${res.via} — ${label}`);
        if (!(await this._waitForNextRound(ctx, tabId, tabs, label, null))) {
          return AutoAnswerStatus.Completed;
        }
        continue;
      }

      rounds++;
      const question = res.question ? ` — "${truncate(res.question, LABEL_MAX)}"` : '';
      const where = progress ? `${progress.current}/${progress.total}` : `round ${rounds}`;
      await ctx.dbg(DBG.INFO, `Answered ${where} via ${res.via} (${res.kind})${question}`);

      // A poll is a single vote — answering swaps the choices for a results
      // view, so there is no next question to wait for.
      if (res.kind === 'poll') return AutoAnswerStatus.Completed;

      if (progress && progress.current >= progress.total) {
        await ctx.dbg(DBG.INFO, `Final question answered — ${label}`);
        return AutoAnswerStatus.Completed;
      }

      // What we just answered, so the wait below can tell the *next* question
      // from a probe that landed before the navigation committed.
      const answered = { progress, question: res.question };
      if (!(await this._waitForNextRound(ctx, tabId, tabs, label, answered))) {
        return AutoAnswerStatus.Completed;
      }
    }

    const capped = rounds >= cap ? `${cap}-round` : `${TIMEOUTS.QUIZ_MAX_ROUNDS}-advance`;
    await ctx.dbg(DBG.WARN, `Auto-answer hit its ${capped} cap — ${label}`);
    return AutoAnswerStatus.Completed;
  }

  /**
   * Poll until there is something to click again. Returns true for a question to
   * answer *or* a reveal to advance past (the caller's next pass re-locates and
   * handles either), and false when there is nothing left at all — quiz over,
   * page changed, or tab gone — which the caller treats as a clean stop, not an
   * error.
   */
  private async _waitForNextRound(
    ctx: Context,
    tabId: number,
    tabs: TabManager,
    label: string,
    answered: AnsweredRound | null,
  ): Promise<boolean> {
    let absent = 0;

    for (let i = 0; i < TIMEOUTS.QUIZ_OPTION_POLLS; i++) {
      ctx.signal.throwIfAborted();
      await sleep(randMs(...TIMING.QUIZ_OPTION_POLL), ctx.signal);

      // A locate-only probe: clickQuizOption would answer the question it is
      // meant to be observing, so ask the page directly and ignore the point.
      const { res } = await tabs.probeQuizOption(tabId, label);

      if (res?.status === LOCATE_STATUS.Ready) {
        absent = 0;
        // An answer reveal is never a stale read — it only exists once the answer
        // landed, and it is reported only when no option is clickable. Hand it
        // straight back so the caller can click "Next".
        if (res.move === QUIZ_MOVE.Advance) return true;
        // Options being clickable is not enough: a probe that lands before the
        // navigation commits still sees the question we just answered, and
        // answering it twice burns a round and can re-submit the same choice.
        if (!isNewRound(answered, res.progress, res.question)) continue;
        return true;
      }

      if (res?.status === LOCATE_STATUS.Satisfied) {
        absent = 0;
        // Nothing to click — but that is also how a just-answered question looks
        // while its options are disabled and the next one hasn't rendered. Only
        // the module declaring itself over, or an exhausted progress label,
        // proves the quiz ended; a missing label means "unreadable", so keep
        // polling rather than abandon the quiz partway through.
        const progress = res.progress;
        // The score summary that follows the last answer. Without this the loop
        // would poll out its whole budget waiting for a question that is never
        // coming, and log a warning for a quiz that in fact finished.
        if (res.state === 'finished') {
          await ctx.dbg(DBG.INFO, `Quiz reports itself finished (${res.via}) — ${label}`);
          return false;
        }
        if (progress && progress.current >= progress.total) return false;
        continue; // mid-quiz: keep waiting for the next question
      }

      if (res?.status === LOCATE_STATUS.Absent) {
        // The page answered and has no module on it. One reading can be a
        // half-rendered SERP mid-navigation, so want a couple in a row — but
        // once they agree, the quiz ended (Bing swaps in a plain SERP after the
        // last answer) and that is a clean finish, not something to warn about.
        if (++absent >= TIMEOUTS.QUIZ_ABSENT_POLLS) {
          await ctx.dbg(DBG.INFO, `Quiz module gone — treating as finished (${label})`);
          return false;
        }
        continue;
      }
      // No response at all: still navigating. Keep polling, and leave the absent
      // streak alone — this is silence, not a contradicting reading.
    }
    await ctx.dbg(DBG.WARN, `Next quiz question never rendered — ${label}`);
    return false;
  }
}

export const autoAnswerQuiz = new AutoAnswerQuizStep();
