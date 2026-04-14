import { CardState } from '../util/activity.js';
import { MSG_ACTION } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import { sleep, randMs, TIMING } from '../util/timing.js';
import { StepBase } from '../interfaces/step.js';
import { truncate, LABEL_MAX } from '../util/format.js';

import type { Activity } from '../util/activity.js';
import type { Context } from '../util/context.js';

export const enum ValidationStatus {
  Completed = 'completed',
  Incomplete = 'incomplete',
  Error = 'error',
}

export type ActivityValidationResult = { status: ValidationStatus };

class ValidateActivityStep extends StepBase<[Activity, number], ActivityValidationResult> {
  readonly name = 'validate-activity';

  async run(
    ctx: Context,
    activity: Activity,
    rewardsTabId: number,
  ): Promise<ActivityValidationResult> {
    chrome.tabs.update(rewardsTabId, { active: true }).catch(() => {
      /* non-critical: tab may have closed */
    });
    await sleep(randMs(...TIMING.VALIDATE_ACTIVITY), ctx.signal);
    const response = await chrome.tabs
      .sendMessage(rewardsTabId, {
        action: MSG_ACTION.VALIDATE_ACTIVITY,
        id: activity.id,
      })
      .catch(() => null);

    const label = `[${activity.id}] ${truncate(activity.title, LABEL_MAX)}`;

    if (!response) {
      await ctx.dbg(DBG.WARN, `Validation: no response — "${label}"`);
      return { status: ValidationStatus.Error };
    }

    const { state } = response;
    if (state === CardState.Completed) {
      await ctx.dbg(DBG.SUCCESS, `Validated complete: "${label}"`);
      return { status: ValidationStatus.Completed };
    }
    if (state === CardState.NotFound) {
      await ctx.dbg(DBG.WARN, `Not found during validation: "${label}"`);
      return { status: ValidationStatus.Error };
    }
    await ctx.dbg(DBG.WARN, `Validation failed: state="${state}" — "${label}"`);
    return { status: ValidationStatus.Incomplete };
  }
}

export const validateActivity = new ValidateActivityStep();
