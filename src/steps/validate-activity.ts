import { CARD_STATE } from '../util/activity.js';
import { MSG_ACTION } from '../util/messaging.js';
import type { Activity } from '../util/activity.js';
import type { Context } from '../util/context.js';

export async function run(ctx: Context, activity: Activity, rewardsTabId: number): Promise<boolean | null> {
  const response = await chrome.tabs.sendMessage(rewardsTabId, {
    action: MSG_ACTION.VALIDATE_ACTIVITY,
    href: activity.href,
  }).catch(() => null);

  const label = (activity.title || activity.href).slice(0, 60);

  if (!response) {
    await ctx.dbg('warn', `Validation: no response — "${label}"`);
    return null;
  }

  const { state } = response;
  if (state === CARD_STATE.COMPLETED) {
    await ctx.dbg('success', `Validated complete: "${label}"`);
    return true;
  }
  if (state === CARD_STATE.NOT_FOUND) {
    await ctx.dbg('warn', `Not found during validation: "${label}"`);
    return null;
  }
  await ctx.dbg('warn', `Validation: state="${state}" — "${label}"`);
  return false;
}
