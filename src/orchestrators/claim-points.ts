// Claims pending "Ready to claim" points from the rewards home page (`/`):
// read the card's value, open the "Claim points" flyout with a trusted CDP
// click, press its confirm button, verify the flyout empties, and close it.
// Runs last in the chain so points earned during this run are included.

import { REWARDS_URL } from '../util/config.js';
import { urlKey } from '../util/url.js';
import { lingerOnPage, randMs, sleep, TIMEOUTS, TIMING } from '../util/timing.js';
import { CONTROL_KIND, MSG_ACTION } from '../util/messaging.js';
import type { ClaimReadResponse } from '../util/messaging.js';
import { DBG } from '../util/debug.js';
import type { Context } from '../util/context.js';
import { loadRunState } from '../util/persistent-state.js';
import { PHASE } from '../util/phase.js';
import { OrchestratorBase } from '../interfaces/orchestrator.js';
import { FAIL } from '../util/failures.js';

/** The "Ready to claim" card only renders on the rewards root page. */
function onRootPage(url: string): boolean {
  try {
    return urlKey(url) === urlKey(REWARDS_URL);
  } catch {
    return false;
  }
}

class ClaimPoints extends OrchestratorBase {
  readonly name = 'Claim points';

  async run(ctx: Context): Promise<void> {
    ctx.signal.throwIfAborted();
    const rewardsTabId = await this._ensureRewardsTab(ctx);
    if (rewardsTabId === null) return;
    await this._claim(ctx, rewardsTabId);
  }

  /**
   * Reuse the already-open rewards tab, navigated back to `/` — the "Ready to
   * claim" card only exists there. The tab survives every earlier phase, so
   * the user may well have closed it; reopen rather than skip, since unclaimed
   * points expire after a month.
   */
  private async _ensureRewardsTab(ctx: Context): Promise<number | null> {
    const existing = (await loadRunState()).rewardsTabId;
    if (existing) {
      const tab = await chrome.tabs.get(existing).catch(() => null);
      if (tab && tab.url && onRootPage(tab.url)) return existing;
      if (tab) {
        try {
          await this.tabs.navigateTab(existing, REWARDS_URL, ctx.signal);
          await ctx.dbg(DBG.INFO, 'Navigated rewards tab to / for the claim card');
          return existing;
        } catch {
          ctx.signal.throwIfAborted(); // a Stop is not a broken tab — don't reopen
          // navigation failed (tab just closed?) — fall through and reopen
        }
      }
    }

    try {
      const tab = await this.tabs.openAndFocusTab(REWARDS_URL, ctx.signal);
      this.tabs.untrackTab(tab.id); // managed by _endRun; must not be closed by closeAll()
      await ctx.setState({ rewardsTabId: tab.id });
      await ctx.dbg(DBG.WARN, 'Rewards tab was gone — reopened it to claim points');
      return tab.id;
    } catch {
      // A user Stop aborts the tab-load wait mid-reopen; that is not a broken
      // tab and must not be logged as one — rethrow so the run ends cleanly.
      ctx.signal.throwIfAborted();
      await ctx.fail(FAIL.TAB, 'Rewards tab not open — cannot claim points');
      return null;
    }
  }

  private async _claim(ctx: Context, rewardsTabId: number): Promise<void> {
    ctx.signal.throwIfAborted();

    const setDone = (message: string) =>
      ctx.setPhase({ phase: PHASE.CLAIM, headerMessage: message, points: 0 });

    // The card's value gates everything — a 0 means the flyout has nothing to
    // claim, so opening it would be a wasted (and suspicious-looking) gesture.
    let card: ClaimReadResponse | null = null;
    for (let i = 0; i < TIMEOUTS.CLAIM_READ_ATTEMPTS; i++) {
      ctx.signal.throwIfAborted();
      card = await this._readClaim(rewardsTabId, 'card');
      if (card?.read) break;
      if (card && !card.read) {
        await ctx.dbg(DBG.WARN, `Claim card read failed: ${card.detail}`);
      }
      if (i < TIMEOUTS.CLAIM_READ_ATTEMPTS - 1) {
        await sleep(randMs(...TIMING.FETCH_COUNTERS_POLL), ctx.signal);
      }
    }
    if (!card?.read || card.target !== 'card') {
      // Not a failure banner: the card plausibly doesn't render at all when
      // nothing is claimable. Selector drift still surfaces in the debug log.
      await ctx.dbg(DBG.WARN, 'Could not read the "Ready to claim" card — skipping claim');
      await setDone('No points to claim');
      return;
    }
    if (card.points === 0) {
      await ctx.dbg(DBG.INFO, 'Nothing to claim (card shows 0)');
      await setDone('No points to claim');
      return;
    }

    await ctx.setPhase({
      phase: PHASE.CLAIM,
      headerMessage: `Claiming ${card.points} points…`,
      progress: { done: 0, total: 1 },
    });

    const open = await this.tabs.clickPageControl(
      rewardsTabId,
      CONTROL_KIND.CLAIM_TOGGLE,
      '"Ready to claim" card',
    );
    if (!open.ok) {
      await ctx.fail(FAIL.TAB, open.error ?? 'Claim card click failed');
      return;
    }

    const flyout = await this._readClaim(rewardsTabId, 'flyout');
    if (!flyout?.read) {
      await ctx.fail(
        FAIL.VALIDATION,
        (flyout && !flyout.read && flyout.detail) || 'Claim flyout unreadable',
      );
      await this._closeDialog(ctx, rewardsTabId);
      return;
    }
    if (flyout.target !== 'flyout' || flyout.empty) {
      await ctx.dbg(DBG.INFO, 'Claim flyout reports nothing to claim');
      await this._closeDialog(ctx, rewardsTabId);
      await setDone('No points to claim');
      return;
    }
    const total = flyout.total ?? card.points;
    if (flyout.rows.length > 0) {
      await ctx.dbg(
        DBG.INFO,
        `Claiming: ${flyout.rows.map((r) => `${r.title} (+${r.points})`).join(', ')}`,
      );
    }

    ctx.signal.throwIfAborted();
    const confirm = await this.tabs.clickPageControl(
      rewardsTabId,
      CONTROL_KIND.CLAIM_CONFIRM,
      '"Claim points" button',
    );
    if (!confirm.ok) {
      await ctx.fail(FAIL.VALIDATION, confirm.error ?? 'Claim button click failed');
      await this._closeDialog(ctx, rewardsTabId);
      return;
    }

    await lingerOnPage('claim settle', TIMING.CLAIM_SETTLE, ctx.signal);
    const claimed = await this._verifyClaimed(ctx, rewardsTabId);
    await this._closeDialog(ctx, rewardsTabId);

    if (claimed) {
      await ctx.dbg(DBG.SUCCESS, `Claimed ${total} points`);
      await ctx.setPhase({
        phase: PHASE.CLAIM,
        headerMessage: `Claimed ${total} points`,
        progress: { done: 1, total: 1 },
        points: total,
      });
    } else {
      // Only verified claims are credited — an optimistic credit would inflate
      // the summary on a silent failure.
      await ctx.fail(
        FAIL.VALIDATION,
        'Claim click sent but not confirmed — points may not have been claimed',
      );
      await ctx.setPhase({
        phase: PHASE.CLAIM,
        headerMessage: 'Claim not confirmed',
        progress: { done: 0, total: 1 },
        points: 0,
      });
    }
  }

  /**
   * Whether the claim landed. Three independent signals count, because the
   * post-claim UI is not pinned down: the flyout reads empty / total 0, or the
   * flyout auto-closed AND the card is gone or reads 0.
   */
  private async _verifyClaimed(ctx: Context, rewardsTabId: number): Promise<boolean> {
    for (let i = 0; i < TIMEOUTS.CLAIM_VERIFY_POLLS; i++) {
      ctx.signal.throwIfAborted();
      const flyout = await this._readClaim(rewardsTabId, 'flyout');
      if (flyout?.read && flyout.target === 'flyout') {
        if (flyout.empty || flyout.total === 0) return true;
      } else {
        const card = await this._readClaim(rewardsTabId, 'card');
        if (!card?.read || (card.target === 'card' && card.points === 0)) return true;
      }
      if (i < TIMEOUTS.CLAIM_VERIFY_POLLS - 1) {
        await sleep(randMs(...TIMING.FETCH_COUNTERS_POLL), ctx.signal);
      }
    }
    return false;
  }

  private async _readClaim(
    rewardsTabId: number,
    target: 'card' | 'flyout',
  ): Promise<ClaimReadResponse | null> {
    const reply: unknown = await chrome.tabs
      .sendMessage(rewardsTabId, { action: MSG_ACTION.READ_CLAIM, target })
      .catch(() => null);
    return (reply as ClaimReadResponse | undefined) ?? null;
  }

  /** Best-effort close — Satisfied (already gone) is free; a failure is only a WARN. */
  private async _closeDialog(ctx: Context, rewardsTabId: number): Promise<void> {
    const close = await this.tabs.clickPageControl(
      rewardsTabId,
      CONTROL_KIND.DIALOG_CLOSE,
      'claim dialog Close',
    );
    if (!close.ok) {
      await ctx.dbg(DBG.WARN, close.error ?? 'Could not close the claim dialog');
    }
  }
}

export { ClaimPoints };
