import { MSG_ACTION, CARD_STATE } from '../util/config.js';
import type { Context } from '../util/context.js';

export interface Tile {
  href:       string;
  ariaLabel?: string;
  biId?:      string;
}

export async function run(ctx: Context, tile: Tile): Promise<boolean | null> {
  if (!ctx.session.rewardsTabId) return null;

  const response = await chrome.tabs.sendMessage(ctx.session.rewardsTabId, {
    action: MSG_ACTION.VALIDATE_TILE,
    href: tile.href,
  }).catch(() => null);

  const label = (tile.ariaLabel || tile.biId || tile.href).slice(0, 60);

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
