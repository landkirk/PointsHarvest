import { CardState } from '../util/activity.js';
import { MSG_ACTION } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import { StepBase } from '../interfaces/step.js';
import type { Activity } from '../util/activity.js';
import type { Context } from '../util/context.js';

class ValidateActivityStep extends StepBase<[Activity, number], boolean | null> {
  readonly name = 'validate-activity';

  async run(ctx: Context, activity: Activity, rewardsTabId: number): Promise<boolean | null> {
    const response = await chrome.tabs.sendMessage(rewardsTabId, {
      action: MSG_ACTION.VALIDATE_ACTIVITY,
      index:  activity.activityIndex,
      target: activity.activityType,
    }).catch(() => null);

    const label = activity.title.slice(0, 60);

    if (!response) {
      await ctx.fail('validation', `Validation: no response — "${label}"`);
      return null;
    }

    const { state } = response;
    if (state === CardState.Completed) {
      await ctx.dbg(DBG.SUCCESS, `Validated complete: "${label}"`);
      return true;
    }
    if (state === CardState.NotFound) {
      await ctx.dbg(DBG.WARN, `Not found during validation: "${label}"`);
      return null;
    }
    await ctx.dbg(DBG.WARN, `Validation: state="${state}" — "${label}"`);
    return false;
  }
}

export const validateActivity = new ValidateActivityStep();
