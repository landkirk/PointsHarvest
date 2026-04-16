import type { RunEndReason, RunState, RunSummary } from './persistent-state.js';
import { ACTIVITY_TYPE, CardState } from './activity-types.js';

export function buildRunSummary(
  state: RunState,
  opts: {
    startedAt: number;
    endedAt: number;
    endReason: RunEndReason;
  },
): RunSummary {
  const activities = state.activityState?.allActivities ?? [];
  let dailySetsCompleted = 0;
  let exploreCompleted = 0;
  let moreActivitiesCompleted = 0;
  let locked = 0;
  let actionableLeftover = 0;
  for (const a of activities) {
    if (a.activityType === ACTIVITY_TYPE.IGNORED) continue;
    if (a.cardState === CardState.Completed) {
      if (a.activityType === ACTIVITY_TYPE.DAILY_SET) dailySetsCompleted++;
      else if (a.activityType === ACTIVITY_TYPE.EXPLORE_ON_BING) exploreCompleted++;
      else if (a.activityType === ACTIVITY_TYPE.MORE_ACTIVITIES) moreActivitiesCompleted++;
    } else if (a.cardState === CardState.Locked) {
      locked++;
    } else if (a.cardState === CardState.Actionable) {
      actionableLeftover++;
    }
  }

  return {
    ...opts,
    phaseStates: state.header.phaseStates,
    activityCounts: {
      dailySetsCompleted,
      exploreCompleted,
      moreActivitiesCompleted,
      locked,
      actionableLeftover,
    },
    failureCount: state.failures.length,
  };
}
