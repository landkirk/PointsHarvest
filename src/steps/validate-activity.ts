import { CardState, sectionForActivityType } from '../util/activity-types.js';
import { MSG_ACTION } from '../util/messaging.js';
import type { ValidateActivityResponse } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import { sleep, randMs, TIMING } from '../util/timing.js';
import { StepBase } from '../interfaces/step.js';
import { truncate, LABEL_MAX } from '../util/format.js';

import type { Activity } from '../util/activity-types.js';
import type { Context } from '../util/context.js';
import type { TabManager } from '../util/tab-manager.js';

export const enum ValidationStatus {
  Completed = 'completed',
  Incomplete = 'incomplete',
  Error = 'error',
}

export type ActivityValidationResult = { status: ValidationStatus };

class ValidateActivityStep extends StepBase<
  [Activity, number, TabManager],
  ActivityValidationResult
> {
  readonly name = 'validate-activity';

  async run(
    ctx: Context,
    activity: Activity,
    rewardsTabId: number,
    tabs: TabManager,
  ): Promise<ActivityValidationResult> {
    const label = `[${activity.id}] ${truncate(activity.title, LABEL_MAX)}`;

    // No title, no lookup: the DOM can only answer by title/href, so the
    // outcome is unknowable — for every attempt, which makes it pointless (and
    // harmful) to report a retryable failure: the re-click double-activates the
    // tile it just opened. Take the click on faith instead.
    if (!activity.title) {
      await ctx.dbg(DBG.WARN, `Validation skipped — card has no title, assuming done: "${label}"`);
      return { status: ValidationStatus.Completed };
    }

    // Focusing the rewards tab doubles as the best shot at triggering the
    // SPA's refetch-on-focus before the read.
    chrome.tabs.update(rewardsTabId, { active: true }).catch(() => {
      /* non-critical: tab may have closed */
    });
    await sleep(randMs(...TIMING.VALIDATE_ACTIVITY), ctx.signal);
    let response = await this.readCard(rewardsTabId, activity);

    if (!response || response.state !== CardState.Completed) {
      // The badge usually flips in the background tab on its own, but the
      // credit can lag the click (explore cards read "Activated" until it
      // lands) — and a collapsed section unmounts its tiles entirely. One
      // recovery pass: reload, re-expand the section, re-read. Only after that
      // is Incomplete real enough to hand executeWithRetry a re-click.
      await ctx.dbg(
        DBG.INFO,
        `Validation inconclusive (${describe(response)}) — reloading rewards tab: "${label}"`,
      );
      await tabs.reloadTab(rewardsTabId, ctx.signal);
      ctx.signal.throwIfAborted();
      const section = sectionForActivityType(activity.activityType);
      if (section) await tabs.expandSection(ctx, rewardsTabId, section);
      response = await this.readCard(rewardsTabId, activity);
    }

    if (!response) {
      await ctx.dbg(DBG.WARN, `Validation: no response — "${label}"`);
      return { status: ValidationStatus.Error };
    }
    if (response.state === CardState.Completed) {
      await ctx.dbg(DBG.SUCCESS, `Validated complete: "${label}"`);
      return { status: ValidationStatus.Completed };
    }
    if (response.state === CardState.NotFound) {
      await ctx.dbg(DBG.WARN, `Not found during validation: "${label}"`);
      return { status: ValidationStatus.Error };
    }
    await ctx.dbg(DBG.WARN, `Validation failed: ${describe(response)} — "${label}"`);
    return { status: ValidationStatus.Incomplete };
  }

  private async readCard(
    rewardsTabId: number,
    activity: Activity,
  ): Promise<ValidateActivityResponse | null> {
    const reply: unknown = await chrome.tabs
      .sendMessage(rewardsTabId, {
        action: MSG_ACTION.VALIDATE_ACTIVITY,
        title: activity.title,
        destinationUrl: activity.destinationUrl,
        activityType: activity.activityType,
      })
      .catch(() => null);
    return (reply as ValidateActivityResponse | undefined) ?? null;
  }
}

/** Human-readable read outcome; surfaces "Activated" (armed, uncredited) distinctly. */
function describe(response: ValidateActivityResponse | null): string {
  if (!response) return 'no response';
  return response.stateLabel
    ? `state="${response.state}", label="${response.stateLabel}"`
    : `state="${response.state}"`;
}

export const validateActivity = new ValidateActivityStep();
