import { sleep, randMs, rawRandMs, TIMEOUTS, TIMING } from './timing.js';
import { CONTROL_KIND, LOCATE_STATUS, MSG_ACTION } from './messaging.js';
import type { AppMessage, ClickPoint, LocateResponse } from './messaging.js';
import type { ActivityType, SectionDescriptor } from './activity-types.js';
import type { Context } from './context.js';
import { FAIL } from './failures.js';
import { DBG } from './debug.js';
import { errMsg } from './errors.js';

export type CapturedTab = chrome.tabs.Tab & { id: number };

/** Fields a card click needs; `Activity` is structurally assignable. */
export interface CardClickTarget {
  title: string;
  destinationUrl: string;
  promoName: string;
  /** Lets the content script scope its card lookup to this activity's section. */
  activityType: ActivityType;
}

export const enum TabCaptureStatus {
  Ok = 'ok',
  Blocked = 'blocked',
  Failed = 'failed',
}

export type TabCaptureResult =
  | { status: TabCaptureStatus.Ok; tab: CapturedTab }
  | { status: TabCaptureStatus.Blocked }
  | { status: TabCaptureStatus.Failed };

interface TabLoadState {
  pendingTabId: number | null;
  pendingResolve: (() => void) | null;
}

function abortable<T>(
  signal: AbortSignal | undefined,
  executor: (resolve: (value: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    let settled = false;
    const onAbort = () => {
      if (!settled) {
        settled = true;
        reject(signal!.reason);
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    executor((value) => {
      if (!settled) {
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      }
    });
  });
}

/**
 * Uniform random float in [min, max) — for click *geometry* (cursor path shape,
 * step count). Delays do not belong here: they go through `randMs`/`rawRandMs`,
 * whose long-tail distribution is the point of humanizing them.
 */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** What `expandSection` concluded about a section. */
export interface SectionExpandResult {
  /** Whether its cards are actually in the DOM — the only thing callers can act on. */
  ready: boolean;
  tiles: number;
  via: string;
}

export class TabManager {
  private readonly openedTabIds = new Set<number>();
  private readonly attachedDebuggees = new Set<number>();
  private tabLoadState: TabLoadState = { pendingTabId: null, pendingResolve: null };
  private _captureResolve: ((tab: chrome.tabs.Tab | null) => void) | null = null;
  /** Only a tab opened *by this tab* may satisfy the pending capture. */
  private _captureOpenerTabId: number | null = null;
  private windowId!: number;

  setWindowId(id: number): void {
    this.windowId = id;
  }

  // ── Orchestrator API ────────────────────────────────────────────────────

  /** Open a new tab, track it, and return it. Throws if creation fails. */
  async openTab(url: string): Promise<chrome.tabs.Tab & { id: number }> {
    const tab = await chrome.tabs
      .create({ url, active: false, windowId: this.windowId })
      .catch(() => null);
    if (!tab) throw new Error(`Failed to open tab: ${url}`);
    if (tab.id === undefined) throw new Error('Opened tab has no ID');
    this.openedTabIds.add(tab.id);
    return tab as chrome.tabs.Tab & { id: number };
  }

  async openAndFocusTab(
    url: string,
    signal?: AbortSignal,
    timeoutMs = TIMEOUTS.TAB_LOAD,
  ): Promise<chrome.tabs.Tab & { id: number }> {
    const tab = await this.openTab(url);
    await this._waitForTabLoad(tab.id, timeoutMs, signal);
    this.focusTab(tab.id);
    return tab;
  }

  focusTab(tabId: number): void {
    chrome.tabs.update(tabId, { active: true }).catch(() => {
      /* tab may already be closed */
    });
  }

  closeTab(tabId: number): void {
    chrome.tabs.remove(tabId).catch(() => {
      /* tab may already be closed */
    });
    this.openedTabIds.delete(tabId);
  }

  /** Close a tab and any child tabs it opened (e.g. CTR-click result tabs). */
  async closeTabWithChildren(tabId: number): Promise<void> {
    const allTabs = await chrome.tabs
      .query({ windowId: this.windowId })
      .catch(() => [] as chrome.tabs.Tab[]);
    for (const child of allTabs) {
      if (child.openerTabId === tabId && child.id !== undefined) {
        chrome.tabs.remove(child.id).catch(() => {});
        this.openedTabIds.delete(child.id);
      }
    }
    this.closeTab(tabId);
  }

  /** Stop tracking a tab without closing it (e.g. user closed it manually). */
  untrackTab(tabId: number): void {
    this.openedTabIds.delete(tabId);
  }

  /** Check that a tab still exists; call ctx.fail and return false if it does not. */
  async assertTabExists(ctx: Context, tabId: number, phase: string): Promise<boolean> {
    const exists = await chrome.tabs.get(tabId).then(
      () => true,
      () => false,
    );
    if (!exists) {
      await ctx.fail(FAIL.TAB, `Rewards tab no longer exists — cannot run ${phase}`);
      return false;
    }
    return true;
  }

  /**
   * Click a card and capture the tab it opens. The click is dispatched via the
   * debugger — the tile's activation beacon is gated on a trusted event that a
   * content script can't forge, so a synthetic click navigates but credits nothing.
   *
   * A click that opens no tab is retried before reporting anything: the first
   * click of a run routinely lands on a tile the page has laid out but not yet
   * painted, so it hit-tests to <body> and does nothing. Re-clicking clears it.
   * Only after every attempt misses is this treated as a blocked pop-up, which is
   * what it looks like from here and rarely is.
   */
  async clickCardAndCaptureTab(
    ctx: Context,
    rewardsTabId: number,
    card: CardClickTarget,
  ): Promise<TabCaptureResult> {
    let tab: chrome.tabs.Tab | null = null;

    for (let attempt = 1; attempt <= TIMEOUTS.CARD_CLICK_ATTEMPTS; attempt++) {
      // Re-clicks get a short capture window: a re-click that works opens its tab
      // almost immediately, so the full window would only delay the Blocked verdict.
      const captureWindow = attempt === 1 ? TIMEOUTS.TAB_CAPTURE : TIMEOUTS.TAB_CAPTURE_RETRY;
      const capturePromise = this._captureNextTab(rewardsTabId, captureWindow, ctx.signal);

      const click = await this._trustedClickCard(rewardsTabId, card);

      if (!click.ok) {
        this._captureResolve?.(null);
        await ctx.fail(FAIL.TAB, click.error ?? `Card click failed for "${card.title}"`);
        return { status: TabCaptureStatus.Failed };
      }

      tab = await capturePromise;
      if (tab) break;

      if (attempt < TIMEOUTS.CARD_CLICK_ATTEMPTS) {
        await ctx.dbg(
          DBG.WARN,
          `No tab opened for "${card.title}" (attempt ${attempt}/${TIMEOUTS.CARD_CLICK_ATTEMPTS}) — clicking again`,
        );
        await sleep(randMs(...TIMING.RETRY_CLICK_PAUSE), ctx.signal);
      }
    }

    if (!tab) {
      return { status: TabCaptureStatus.Blocked };
    }

    if (tab.id === undefined) throw new Error('Captured tab has no ID');
    this.openedTabIds.add(tab.id);

    await this._waitForTabLoad(tab.id, TIMEOUTS.TAB_LOAD, ctx.signal);
    this.focusTab(tab.id as number);

    return { status: TabCaptureStatus.Ok, tab: tab as CapturedTab };
  }

  /**
   * Ask the page where a target is. Pure query — the content script does not
   * click, and does not even scroll unless it reports Ready.
   *
   * Kept separate from `_clickAt` so a caller can *poll* a target's state without
   * clicking it. Folding the two together makes any confirm-loop re-click what it
   * is trying to observe.
   */
  private async _locate(
    rewardsTabId: number,
    msg: AppMessage,
    label: string,
  ): Promise<{ ok: boolean; res?: LocateResponse; error?: string }> {
    this.focusTab(rewardsTabId); // ensure the tab is laid out for correct coordinates
    // Attach BEFORE locating: a fresh attach pops the banner / warms the input
    // pipeline, which would otherwise drop the first click and reflow the page
    // under coordinates we'd already measured.
    try {
      await this._ensureDebuggerAttached(rewardsTabId);
    } catch (err) {
      return { ok: false, error: `Debugger attach failed for ${label}: ${errMsg(err)}` };
    }
    let res: LocateResponse | null;
    try {
      res = await chrome.tabs.sendMessage(rewardsTabId, msg);
    } catch (err) {
      return { ok: false, error: `Locate message error for ${label}: ${errMsg(err)}` };
    }
    if (!res) return { ok: false, error: `No response locating ${label}` };
    return { ok: true, res };
  }

  /** Dispatch the trusted click at an already-located point. */
  private async _clickAt(
    rewardsTabId: number,
    point: ClickPoint,
    label: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.trustedClick(rewardsTabId, point);
    } catch (err) {
      return { ok: false, error: `Trusted click failed for ${label}: ${errMsg(err)}` };
    }
    return { ok: true };
  }

  /**
   * Locate a target and click it. Every click in the rewards page goes through
   * here, so a tile and a section toggle get the identical gesture.
   *
   * Returns without clicking when the target is already in its desired state
   * (Satisfied) or isn't there (Absent) — `ok` reports whether the exchange
   * worked, not whether a click happened.
   */
  private async _locateAndClick(
    rewardsTabId: number,
    msg: AppMessage,
    label: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const loc = await this._locate(rewardsTabId, msg, label);
    if (!loc.ok || !loc.res) return { ok: false, error: loc.error };
    const res = loc.res;

    if (res.status === LOCATE_STATUS.Absent) {
      return {
        ok: false,
        error: `Element not found for ${label}: ${res.reason} (${res.tiles} tiles in section)`,
      };
    }
    if (res.status === LOCATE_STATUS.Satisfied) {
      return { ok: true };
    }
    return this._clickAt(rewardsTabId, res.point, label);
  }

  /** Locate the tile in the page, then dispatch a real click over CDP. */
  private async _trustedClickCard(
    rewardsTabId: number,
    card: CardClickTarget,
  ): Promise<{ ok: boolean; error?: string }> {
    return this._locateAndClick(
      rewardsTabId,
      {
        action: MSG_ACTION.LOCATE_CARD,
        title: card.title,
        destinationUrl: card.destinationUrl,
        promoName: card.promoName,
        activityType: card.activityType,
      },
      `card "${card.title}"`,
    );
  }

  /** Navigate an already-tracked tab to a new URL and wait for it to finish loading. */
  async navigateTab(tabId: number, url: string, signal?: AbortSignal): Promise<void> {
    await chrome.tabs.update(tabId, { url });
    await this._waitForTabLoad(tabId, TIMEOUTS.TAB_LOAD, signal);
  }

  /**
   * Dispatch a genuine (isTrusted) left click on a tile via the Chrome DevTools
   * Protocol, humanized to avoid behavioral fingerprinting: it lands on a random
   * point within the tile (not dead-center) and approaches along a short, bowed
   * cursor path with randomized inter-event timing — rather than teleporting the
   * cursor and clicking instantly. Attaches the debugger lazily (detached in
   * closeAll()). Throws if attach/dispatch fails (e.g. DevTools already attached).
   *
   * Delays come from the shared `TIMING.CLICK_SIMULATION_*` presets — the same
   * ones the search content script paces its result clicks with, since it is the
   * same gesture; their long-tail distribution is what makes the pacing human
   * rather than uniform. `rawRandMs` (not `randMs`) because these are
   * intra-gesture micro-delays: a real click doesn't get slower on Stealth.
   */
  async trustedClick(tabId: number, p: ClickPoint): Promise<void> {
    await this._ensureDebuggerAttached(tabId);

    const clamp = (v: number, hi: number) => Math.max(6, Math.min(hi - 6, v));
    // Aim at a random point within the tile's inner half, not its exact center.
    const tx = clamp(p.x + (Math.random() - 0.5) * p.w * 0.5, p.vw);
    const ty = clamp(p.y + (Math.random() - 0.5) * p.h * 0.5, p.vh);

    // Approach from a nearby off-target point along a short, slightly curved path.
    const angle = Math.random() * Math.PI * 2;
    const dist = rand(70, 170);
    const sx = clamp(tx + Math.cos(angle) * dist, p.vw);
    const sy = clamp(ty + Math.sin(angle) * dist, p.vh);
    const steps = Math.floor(rand(6, 10));
    const bowMag = rand(-1, 1) * rand(8, 20); // perpendicular curvature, peaks mid-path

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = t * t * (3 - 2 * t); // smoothstep — accelerate then decelerate
      const bow = Math.sin(t * Math.PI) * bowMag;
      const mx = clamp(sx + (tx - sx) * ease - Math.sin(angle) * bow, p.vw);
      const my = clamp(sy + (ty - sy) * ease + Math.cos(angle) * bow, p.vh);
      await this._cdpMouse(tabId, 'mouseMoved', mx, my, 0);
      await sleep(rawRandMs(...TIMING.CLICK_SIMULATION_MOVE_DELAY));
    }

    await this._cdpMouse(tabId, 'mouseMoved', tx, ty, 0);
    await sleep(rawRandMs(...TIMING.CLICK_SIMULATION_SETTLE_DELAY)); // settle before pressing
    await this._cdpMouse(tabId, 'mousePressed', tx, ty, 1);
    await sleep(rawRandMs(...TIMING.CLICK_SIMULATION_HOLD_DOWN_DELAY)); // human press-hold
    await this._cdpMouse(tabId, 'mouseReleased', tx, ty, 0);
  }

  private async _cdpMouse(
    tabId: number,
    type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
    x: number,
    y: number,
    buttons: number,
  ): Promise<void> {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: type === 'mouseMoved' ? 'none' : 'left',
      buttons,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
  }

  private async _ensureDebuggerAttached(tabId: number): Promise<void> {
    if (this.attachedDebuggees.has(tabId)) return;
    await chrome.debugger.attach({ tabId }, '1.3');
    this.attachedDebuggees.add(tabId);
    await sleep(TIMEOUTS.DEBUGGER_ATTACH_SETTLE); // let the banner reflow + input pipeline warm up
  }

  /** Called when Chrome auto-detaches our debugger (DevTools opened, tab closed). */
  forgetDebuggee(tabId: number): void {
    this.attachedDebuggees.delete(tabId);
  }

  private async _detachAllDebuggers(): Promise<void> {
    const ids = [...this.attachedDebuggees];
    this.attachedDebuggees.clear();
    for (const id of ids) {
      await chrome.debugger.detach({ tabId: id }).catch(() => {
        /* already detached (tab closed / DevTools took over) */
      });
    }
  }

  /**
   * Open a section so its cards are in the DOM, or confirm it is already open.
   *
   * Two gates: a disclosure toggle (a collapsed section renders no clickable
   * cards) and a "Show more" control that pages in the rest. Both are clicked
   * through the same trusted path as the tiles.
   *
   * Reports `ready` off the *tile count*, not the toggle's aria-expanded. The
   * toggle is a proxy; tiles-in-DOM is what callers actually need, and a section
   * may legitimately have no toggle at all.
   */
  async expandSection(
    ctx: Context,
    rewardsTabId: number,
    section: SectionDescriptor,
  ): Promise<SectionExpandResult> {
    const toggleMsg: AppMessage = {
      action: MSG_ACTION.LOCATE_CONTROL,
      control: CONTROL_KIND.SECTION_TOGGLE,
      sectionKey: section.key,
    };
    const moreMsg: AppMessage = {
      action: MSG_ACTION.LOCATE_CONTROL,
      control: CONTROL_KIND.SHOW_MORE,
      sectionKey: section.key,
    };
    const toggleLabel = `section toggle "${section.label}"`;
    const moreLabel = `"Show more" in "${section.label}"`;

    let probe = await this._locate(rewardsTabId, toggleMsg, toggleLabel);

    // Click once, then poll until the state settles — never re-click on a stale
    // read. A fixed sleep that lands short of React's commit would re-read
    // aria-expanded="false" on a section we just opened and click it shut again.
    // Only a blown deadline proves the click genuinely missed.
    for (let round = 1; round <= TIMEOUTS.SECTION_TOGGLE_CLICK_ROUNDS; round++) {
      if (!probe.ok || probe.res?.status !== LOCATE_STATUS.Ready) break;

      ctx.signal.throwIfAborted();
      const click = await this._clickAt(rewardsTabId, probe.res.point, toggleLabel);
      if (!click.ok) {
        await ctx.dbg(DBG.WARN, click.error ?? `Could not click ${toggleLabel}`);
        break;
      }

      const deadline = Date.now() + TIMEOUTS.EXPAND_SECTION_RENDER;
      while (Date.now() < deadline) {
        await sleep(TIMEOUTS.SECTION_CONFIRM_POLL, ctx.signal);
        const check = await this._locate(rewardsTabId, toggleMsg, toggleLabel);
        // A transient messaging error mid-render means "not settled yet", not
        // failure — keep polling rather than condemning the section on one miss.
        if (!check.ok) continue;
        probe = check;
        if (check.res?.status !== LOCATE_STATUS.Ready) break; // Satisfied = open; Absent = gone
      }
      if (probe.res?.status !== LOCATE_STATUS.Ready) break; // settled

      // Deadline blown with the toggle still collapsed — either the click missed
      // or the SPA is committing slower than the confirm window, and re-clicking
      // a section that is mid-open toggles it shut again. Grant one more full
      // render window before the re-read, so only a genuinely missed click
      // reaches the next round. (The re-read also matters when the poll never
      // landed a successful read, leaving `probe` holding pre-click coordinates.)
      if (round < TIMEOUTS.SECTION_TOGGLE_CLICK_ROUNDS) {
        await sleep(TIMEOUTS.EXPAND_SECTION_RENDER, ctx.signal);
        probe = await this._locate(rewardsTabId, toggleMsg, toggleLabel);
      }
    }

    let via = 'none';
    let tiles = 0;
    if (probe.ok && probe.res) {
      tiles = probe.res.tiles;
      if (probe.res.status === LOCATE_STATUS.Absent) {
        // Ambiguous and often benign — a section may simply not be collapsible.
        // The tile count is what decides whether it mattered.
        await ctx.dbg(DBG.WARN, `No disclosure toggle found for "${section.label}"`);
      } else {
        via = probe.res.via;
      }
    } else if (probe.error) {
      await ctx.dbg(DBG.WARN, probe.error);
    }

    // Page in the rest. Unlike the toggle, a stale read here is harmless — extra
    // pages are monotonic, with no state to corrupt — so a fixed settle is fine.
    let previous = -1;
    for (let i = 0; i < TIMEOUTS.SHOW_MORE_CLICKS; i++) {
      ctx.signal.throwIfAborted();
      const more = await this._locate(rewardsTabId, moreMsg, moreLabel);
      if (!more.ok || !more.res) break;
      tiles = more.res.tiles;
      if (more.res.status !== LOCATE_STATUS.Ready) break; // no control left — every page is in
      if (tiles <= previous) break; // the last click revealed nothing new
      previous = tiles;

      const click = await this._clickAt(rewardsTabId, more.res.point, moreLabel);
      if (!click.ok) {
        await ctx.dbg(DBG.WARN, click.error ?? `Could not click ${moreLabel}`);
        break;
      }
      await sleep(TIMEOUTS.EXPAND_SECTION_RENDER, ctx.signal);
    }

    return { ready: tiles > 0, tiles, via };
  }

  // ── Internal / lifecycle ────────────────────────────────────────────────

  onTabUpdated(tabId: number, changeInfo: { status?: string }): void {
    const { pendingTabId, pendingResolve } = this.tabLoadState;
    if (changeInfo.status === 'complete' && tabId === pendingTabId && pendingResolve) {
      this.tabLoadState.pendingResolve = null;
      this.tabLoadState.pendingTabId = null;
      pendingResolve();
    }
  }

  onTabCreated(tab: chrome.tabs.Tab): void {
    // A capture is satisfied only by a tab the clicked page itself opened — a
    // tab the user opens (Ctrl+T) or another extension creates mid-window must
    // not be adopted, searched in, and closed as if it were the activity tab.
    if (
      this._captureResolve &&
      tab.openerTabId !== undefined &&
      tab.openerTabId === this._captureOpenerTabId
    ) {
      const resolve = this._captureResolve;
      this._captureResolve = null;
      resolve(tab);
      return;
    }
    if (
      tab.id !== undefined &&
      tab.openerTabId !== undefined &&
      this.openedTabIds.has(tab.openerTabId)
    ) {
      this.openedTabIds.add(tab.id);
    }
  }

  async closeAll(): Promise<void> {
    await this._detachAllDebuggers(); // removes the "being debugged" banner
    const ids = [...this.openedTabIds];
    this.openedTabIds.clear();
    for (const id of ids) {
      chrome.tabs.remove(id).catch(() => {});
      await sleep(randMs(300, 1200));
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async _waitForTabLoad(
    tabId: number,
    timeoutMs = TIMEOUTS.TAB_LOAD,
    signal?: AbortSignal,
  ): Promise<void> {
    this.tabLoadState.pendingTabId = tabId;
    try {
      await Promise.race([
        abortable<void>(signal, (resolve) => {
          this.tabLoadState.pendingResolve = resolve;
        }),
        sleep(timeoutMs, signal),
      ]);
    } finally {
      this.tabLoadState.pendingResolve = null;
      this.tabLoadState.pendingTabId = null;
    }
  }

  private async _captureNextTab(
    openerTabId: number,
    timeoutMs = TIMEOUTS.TAB_CAPTURE,
    signal?: AbortSignal,
  ): Promise<chrome.tabs.Tab | null> {
    this._captureOpenerTabId = openerTabId;
    const capturePromise = abortable<chrome.tabs.Tab | null>(signal, (resolve) => {
      this._captureResolve = resolve;
    });
    try {
      return await Promise.race([capturePromise, sleep(timeoutMs, signal).then(() => null)]);
    } finally {
      this._captureResolve = null;
      this._captureOpenerTabId = null;
    }
  }
}
