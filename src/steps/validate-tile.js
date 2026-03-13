import { MSG_ACTION, CARD_STATE } from '../util/config.js';
import { dbg } from '../util/debug.js';

/**
 * Checks the current rewards page DOM to confirm a specific tile is marked complete.
 * Works for any tile type (search card, daily set, linger activity).
 *
 * @param {number} rewardsTabId
 * @param {{ href: string, ariaLabel?: string, biId?: string }} tile
 * @returns {Promise<boolean|null>} true=complete, false=not yet, null=indeterminate
 */
export async function validateTileComplete(rewardsTabId, tile) {
  if (!rewardsTabId || !tile?.href) return null;

  const response = await chrome.tabs.sendMessage(rewardsTabId, {
    action: MSG_ACTION.VALIDATE_TILE,
    href: tile.href,
  }).catch(() => null);

  const label = (tile.ariaLabel || tile.biId || tile.href).slice(0, 60);

  if (!response) {
    await dbg('warn', `Validation: no response — "${label}"`);
    return null;
  }

  const { state } = response;
  if (state === CARD_STATE.COMPLETED) {
    await dbg('success', `Validated complete: "${label}"`);
    return true;
  }
  if (state === CARD_STATE.NOT_FOUND) {
    await dbg('warn', `Not found during validation: "${label}"`);
    return null;
  }
  await dbg('warn', `Validation: state="${state}" — "${label}"`);
  return false;
}
