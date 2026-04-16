import { lingerOnPage } from './timing.js';
import { DBG } from './debug.js';
import { markActivityCompleted } from './activity.js';
import type { Activity } from './activity.js';
import type { Context } from './context.js';
import type { PhaseDefinition } from './phase.js';

export interface RunActivityLoopOpts {
  ctx: Context;
  phase: PhaseDefinition;
  activities: Activity[];
  alreadyCompletedCount: number;
  alreadyCompletedPoints: number;
  lingerLabel: string;
  statusLine: (activity: Activity) => string;
  skip?: (activity: Activity) => string | null;
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
    activities,
    alreadyCompletedCount,
    alreadyCompletedPoints,
    lingerLabel,
    statusLine,
    skip,
    attempt,
  } = opts;

  const phaseLabel = phase.label;

  ctx.signal.throwIfAborted();

  const phaseTotal = alreadyCompletedCount + activities.length;
  let earnedPts = alreadyCompletedPoints;
  let successCount = 0;

  const setStatus = (done: number, headerMessage: string) =>
    ctx.setPhase({
      phase,
      headerMessage,
      progress: { done, total: phaseTotal },
      points: earnedPts,
    });

  await setStatus(
    alreadyCompletedCount,
    `${phaseLabel} (${alreadyCompletedCount} / ${phaseTotal})`,
  );

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
      await setStatus(done, status);
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
        const finalDone = alreadyCompletedCount + successCount;
        await setStatus(finalDone, `${phaseLabel} (${finalDone} / ${phaseTotal})`);
      }
    } finally {
      ctx.activeActivity = null;
    }
  }
}
