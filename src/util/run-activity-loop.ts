// Shared iteration skeleton for activity phases (explore-on-bing, daily sets).
// Callers pre-filter and pre-sum, then provide a per-activity `attempt` closure
// that owns the phase-specific retry logic. The helper owns the loop mechanics:
// signal checks, activeActivity guard, header updates, success bookkeeping,
// and linger between iterations.

import { lingerOnPage } from './timing.js';
import { DBG } from './debug.js';
import { markActivityCompleted } from './activity.js';
import type { Activity } from './activity.js';
import type { Context } from './context.js';
import type { PhaseKey, PhasePointsMap } from './persistent-state.js';

export interface RunActivityLoopOpts {
  ctx: Context;
  phase: PhaseKey;
  phaseLabel: string;
  activities: Activity[];
  alreadyCompletedCount: number;
  alreadyCompletedPoints: number;
  lingerLabel: string;
  statusLine: (activity: Activity) => string;
  skip?: (activity: Activity) => string | null;
  // `progress` is informational — this loop computes it anyway, so it's passed
  // for free. Only explore uses it (to build a retryHeaderPayload on failure);
  // daily ignores it. Not worth a callback abstraction just to hide the arg.
  attempt: (
    activity: Activity,
    index: number,
    progress: { done: number; points: number },
  ) => Promise<boolean>;
}

export async function runActivityLoop(opts: RunActivityLoopOpts): Promise<void> {
  const {
    ctx,
    phase,
    phaseLabel,
    activities,
    alreadyCompletedCount,
    alreadyCompletedPoints,
    lingerLabel,
    statusLine,
    skip,
    attempt,
  } = opts;

  ctx.signal.throwIfAborted();

  const phaseTotal = alreadyCompletedCount + activities.length;
  let earnedPts = alreadyCompletedPoints;
  let successCount = 0;

  const points = (pts: number): Partial<PhasePointsMap> => ({ [phase]: pts });

  await ctx.updateHeader({
    headerMessage: `${phaseLabel} (${alreadyCompletedCount} / ${phaseTotal})`,
    activePhase: phase,
    phaseProgress: { done: alreadyCompletedCount, total: phaseTotal },
    phasePoints: points(earnedPts),
  });

  for (let i = 0; i < activities.length; i++) {
    ctx.signal.throwIfAborted();
    const activity = activities[i];
    ctx.activeActivity = activity;
    try {
      const skipReason = skip?.(activity) ?? null;
      if (skipReason !== null) {
        await ctx.dbg(DBG.WARN, skipReason);
        continue;
      }

      const done = alreadyCompletedCount + successCount;
      const status = statusLine(activity);
      await ctx.updateHeader({
        headerMessage: status,
        activePhase: phase,
        phaseProgress: { done, total: phaseTotal },
        phasePoints: points(earnedPts),
      });
      await ctx.dbg(
        DBG.INFO,
        `[${activity.id}] [${phaseLabel} ${i + 1}/${activities.length}] ${status}`,
      );

      const ok = await attempt(activity, i, { done, points: earnedPts });
      if (!ok) continue;

      await markActivityCompleted(activity.id);
      earnedPts += activity.points;
      successCount++;
      ctx.signal.throwIfAborted();
      await ctx.dbg(
        DBG.SUCCESS,
        `[${activity.id}] ${phaseLabel} ${successCount}/${activities.length} complete`,
      );

      if (i < activities.length - 1) {
        // next iteration will paint its own status header — skip the interim reset
        await lingerOnPage(lingerLabel, undefined, ctx.signal);
        ctx.signal.throwIfAborted();
      } else {
        // last activity — paint the final completed state
        await ctx.updateHeader({
          headerMessage: `${phaseLabel} (${alreadyCompletedCount + successCount} / ${phaseTotal})`,
          activePhase: phase,
          phaseProgress: { done: alreadyCompletedCount + successCount, total: phaseTotal },
          phasePoints: points(earnedPts),
        });
      }
    } finally {
      ctx.activeActivity = null;
    }
  }
}
