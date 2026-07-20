// Injected into rewards.bing.com. Message router for the rewards dashboard.
//
// Everything here reads the DOM (the dashboard API 401s even for live
// sessions): REWARDS_STATUS answers readiness/login, EXTRACT_SECTIONS parses
// tiles into RawCards (rewards-dom.ts), VALIDATE_ACTIVITY re-reads a card's
// badge, READ_COUNTERS parses the open "Points breakdown" flyout, and the
// locate handlers report where to aim the background's trusted CDP clicks.

import { CardState, sectionByKey, sectionForActivityType } from '../util/activity-types.js';
import type { ActivityType, SectionDescriptor } from '../util/activity-types.js';
import { PC_SEARCH_TYPE } from '../util/config.js';
import { TIMEOUTS, sleep } from '../util/timing.js';
import { CONTROL_KIND, LOCATE_STATUS, MSG_ACTION } from '../util/messaging.js';
import type {
  AppMessage,
  ClaimReadResponse,
  ClickPoint,
  CountersResponse,
  ExtractResponse,
  LocateResponse,
  RewardsStatusResponse,
  ValidateActivityResponse,
} from '../util/messaging.js';
import {
  clean,
  findBreakdownDialog,
  findClaimCard,
  findClaimConfirm,
  findClaimDialog,
  findDialogClose,
  findPointsToggle,
  isVisible,
  parseClaimCardPoints,
  parseClaimFlyout,
  parsePointsBreakdown,
  parseSectionCards,
  sectionEl,
  tileCount,
  tileState,
  tileStateLabel,
  TILE_SELECTOR,
} from './rewards-dom.js';
import { urlKey } from '../util/url.js';

// The header renders a bare "Sign in" control beside the account avatar when
// there's no session (signed in, it shows the account name instead), and carries
// no marketing copy that text sniffing could catch. Match on an element whose
// *entire* text is "Sign in" so ordinary prose containing the words can't trip it.
const SIGN_IN_LABEL = /^sign in$/i;

function hasSignInControl(): boolean {
  const candidates = document.querySelectorAll<HTMLElement>('p, a, button, span');
  return Array.from(candidates).some(
    (el) => SIGN_IN_LABEL.test((el.textContent ?? '').trim().replace(/\s+/g, ' ')) && isVisible(el),
  );
}

/**
 * Which signed-out signal the DOM shows, or `null` if none.
 *
 * Only positive evidence counts — anything else (including a page that is still
 * loading) reads as `null`. This heuristic is now the login authority (the
 * dashboard API 401s even for live sessions, so there is nothing to hold it
 * against): the background polls it via REWARDS_STATUS and re-probes a few
 * times after the page completes before trusting a null, since the SPA can
 * hydrate the header after readyState fires.
 *
 * Naming the matched signal (rather than a bare boolean) is what makes a
 * "not logged in" verdict diagnosable in the debug log. The two conservative
 * gates below keep false positives out: the page must have finished loading (a
 * still-loading SPA can paint a signed-out skeleton before the session hydrates),
 * and the control must be visible.
 */
function loggedOutSignal(): string | null {
  if (document.readyState !== 'complete') return null;
  if (hasSignInControl()) return 'visible "Sign in" control in header';

  const bodyText = (document.body?.textContent || '').toLowerCase();
  const LOGOUT_SIGNALS = ['sign in to start earning', 'sign in to earn', 'start earning rewards'];
  const match = LOGOUT_SIGNALS.find((s) => bodyText.includes(s));
  return match ? `page text contains "${match}"` : null;
}

// ── Card resolution ─────────────────────────────────────────────────────────

// clean() (zero-width strip + whitespace collapse, NBSP included) plus
// lowercasing, so DOM titles compare equal to the cleaned extraction titles.
function cleanText(s: string): string {
  return clean(s).toLowerCase();
}

/**
 * The anchors a card could be, narrowed to its own section.
 *
 * Titles are only unique *within* a section: `/earn` also renders `section#quests`
 * and `section#levelup`, whose tiles can share a title — or merely a text prefix —
 * with an activity, and a document-wide scan silently returns whichever comes
 * first in DOM order. Falls back to the whole document when the section isn't
 * present (an id that drifted), which is no worse than an unscoped scan.
 */
function cardAnchors(activityType: ActivityType): HTMLAnchorElement[] {
  const section = sectionForActivityType(activityType);
  const el = section ? sectionEl(section.id) : null;
  return Array.from((el ?? document).querySelectorAll<HTMLAnchorElement>(TILE_SELECTOR));
}

// Primary matcher: locate the card anchor by its title, tie-breaking duplicate
// titles by exact href. Explore tiles all share ONE destinationUrl, so the
// title is the primary key there; conversely, stale daily quizzes recycle
// titles in "Keep earning" while their date-stamped hrefs stay unique — each
// key covers the other's blind spot. Matches the img[alt], then the title <p>,
// then the anchor text.
function findCardByTitle(
  title: string,
  destinationUrl: string,
  anchors: HTMLAnchorElement[],
): HTMLAnchorElement | undefined {
  const want = cleanText(title);
  if (!want) return undefined;
  const tiers: ((a: HTMLAnchorElement) => boolean)[] = [
    (a) => cleanText(a.querySelector('img')?.alt ?? '') === want,
    (a) => cleanText(a.querySelector('p')?.textContent ?? '') === want,
    (a) => cleanText(a.textContent ?? '').startsWith(want),
  ];
  for (const matches of tiers) {
    const hits = anchors.filter(matches);
    if (hits.length === 0) continue;
    if (hits.length > 1 && destinationUrl) {
      const target = normalizeHref(destinationUrl);
      const byHref = hits.find((a) => normalizeHref(a.href) === target);
      if (byHref) return byHref;
    }
    return hits[0];
  }
  return undefined;
}

// Origin + path + query, lowercased — a stable key for comparing a card's live
// href against the extraction-time destinationUrl regardless of fragment or
// casing. Extraction captures the anchor's own resolved href, so equality is
// exact by construction.
function normalizeHref(u: string): string {
  return urlKey(u, { withQuery: true, base: location.href });
}

/**
 * Fallback matcher, used when title matching misses. Counts only when the href
 * matches exactly one anchor: every explore tile shares one destinationUrl, so
 * on a shared href reporting the card absent beats silently clicking (and
 * crediting) the wrong tile.
 */
function findCardByDestination(
  destinationUrl: string,
  anchors: HTMLAnchorElement[],
): HTMLAnchorElement | undefined {
  if (!destinationUrl) return undefined;
  const target = normalizeHref(destinationUrl);
  const matches = anchors.filter((a) => normalizeHref(a.href) === target);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Resolve an activity to its anchor: by title (href tie-break), then by destination. */
function resolveCard(msg: {
  title: string;
  destinationUrl: string;
  activityType: ActivityType;
}): HTMLAnchorElement | undefined {
  const anchors = cardAnchors(msg.activityType);
  return (
    findCardByTitle(msg.title, msg.destinationUrl, anchors) ??
    findCardByDestination(msg.destinationUrl, anchors)
  );
}

// ── Section control resolution ──────────────────────────────────────────────

/** How a control was resolved — logged so selector drift is diagnosable from a run log. */
type Via = 'section-descendant' | 'aria-controls' | 'label' | 'text-scan' | 'none';

/** The element `aria-controls` points at, if it resolves. */
function controlledPanel(btn: HTMLElement): HTMLElement | null {
  const id = btn.getAttribute('aria-controls');
  return id ? document.getElementById(id) : null;
}

/** The nearest heading above a control, searching its own header container. */
function nearbyHeading(btn: HTMLElement): string {
  let node: HTMLElement | null = btn.parentElement;
  for (let i = 0; i < 3 && node; i++) {
    if (node.tagName === 'SECTION' || node.tagName === 'MAIN') break;
    const h = node.querySelector('h2');
    if (h) return cleanText(h.textContent ?? '');
    node = node.parentElement;
  }
  return '';
}

function matchesLabel(text: string, desc: SectionDescriptor): boolean {
  return text !== '' && desc.labelPatterns.some((p) => p.test(text));
}

/**
 * Find a section's disclosure toggle — the control that gates whether its cards
 * render at all.
 *
 * Ordered tiers, first match wins. Nothing here can key off the markup itself:
 * classes are generated Tailwind and ids are generated by react-aria, so
 * `aria-expanded` (which we must read anyway to know the state) is the only
 * viable candidate filter. `slot="trigger"` and `data-react-aria-pressable` look
 * tempting but discriminate nothing — the latter is on cards too.
 *
 * `aria-expanded` alone isn't enough, though: the section header's info (ⓘ)
 * button is a react-aria popover trigger, so it *also* carries `aria-expanded`,
 * and it precedes the real disclosure toggle in DOM order — a naive "first
 * button inside the section" grabs it and we click the info bubble forever.
 * Popover/menu/dialog triggers advertise themselves with `aria-haspopup`; a
 * genuine disclosure toggle never does, so we drop any button that has it.
 *
 * The label tier is last because it is the only *localized* signal: `aria-label`
 * is "Keep earning" here and something else entirely on a non-English profile,
 * whereas `section#moreactivities` holds everywhere. It still earns its place —
 * see SectionDescriptor.labelPatterns.
 */
function resolveSectionToggle(
  section: HTMLElement | null,
  desc: SectionDescriptor,
): { el: HTMLButtonElement; via: Via } | null {
  // Any state, not just aria-expanded="false" — reading the state is the point.
  // Exclude popover/menu/dialog triggers (info buttons): they carry aria-expanded
  // too, but a disclosure toggle never sets aria-haspopup.
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'),
  ).filter((b) => isVisible(b) && !b.hasAttribute('aria-haspopup'));

  if (section) {
    // Prefer the button whose disclosure panel actually is (or wraps) this
    // section's card grid — that's unambiguously the section's own toggle, not a
    // sibling control that merely happens to sit inside the header.
    const byOwnPanel = buttons.find((b) => {
      const panel = controlledPanel(b);
      return !!panel && (panel === section || panel.contains(section) || section.contains(panel));
    });
    if (byOwnPanel) return { el: byOwnPanel, via: 'aria-controls' };

    // DOM order matters: the section header precedes the card grid, so its
    // toggle wins over any per-card expandable nested deeper in the section.
    const inside = buttons.find((b) => section.contains(b));
    if (inside) return { el: inside, via: 'section-descendant' };
  }

  const byLabel = buttons.find((b) => matchesLabel(cleanText(b.ariaLabel ?? ''), desc));
  if (byLabel) return { el: byLabel, via: 'label' };

  const byHeading = buttons.find((b) => matchesLabel(nearbyHeading(b), desc));
  if (byHeading) return { el: byHeading, via: 'text-scan' };

  return null;
}

/** The section's "Show more" pagination control, if it still has pages to reveal. */
function resolveShowMore(section: HTMLElement): HTMLButtonElement | null {
  return (
    Array.from(section.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => /\b(show|see|view)\s+more\b/i.test(b.textContent ?? '') && isVisible(b),
    ) ?? null
  );
}

/**
 * An element's on-screen geometry, for the background to aim a trusted click at.
 * Scrolls it into view first, so callers must only reach here once they've
 * decided a click is actually needed — this is not a free query.
 */
async function locateElement(el: HTMLElement): Promise<ClickPoint | null> {
  el.scrollIntoView({ block: 'center', inline: 'center' });
  await sleep(TIMEOUTS.SCROLL_SETTLE);
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    w: r.width,
    h: r.height,
    vw: window.innerWidth,
    vh: window.innerHeight,
  };
}

chrome.runtime.onMessage.addListener((msg: AppMessage, _sender, sendResponse) => {
  if (msg.action === MSG_ACTION.REWARDS_STATUS) {
    // Readiness/login probe, answered synchronously. Merely being able to answer
    // proves the content script is injected; the fields say whether the page has
    // finished loading and whether it shows signed-out evidence.
    const response: RewardsStatusResponse = {
      domComplete: document.readyState === 'complete',
      loggedOutSignal: loggedOutSignal(),
    };
    sendResponse(response);
    return undefined;
  }

  if (msg.action === MSG_ACTION.EXTRACT_SECTIONS) {
    void (async () => {
      // The orchestrator navigates/expands each section before asking, so
      // tiles are normally already in the DOM — the poll only rides out the
      // React commit after an expansion.
      const response: ExtractResponse = { cards: [], sectionTiles: {}, warnings: [] };
      for (const key of msg.sections) {
        const deadline = Date.now() + TIMEOUTS.EXTRACT_SECTION_WAIT;
        let result = parseSectionCards(key);
        while (result.tiles === 0 && Date.now() < deadline) {
          await sleep(TIMEOUTS.SECTION_CONFIRM_POLL);
          result = parseSectionCards(key);
        }
        response.cards.push(...result.cards);
        response.sectionTiles[key] = result.tiles;
        response.warnings.push(...result.warnings);
      }
      sendResponse(response);
    })();
    return true; // async sendResponse
  }

  if (msg.action === MSG_ACTION.LOCATE_CARD) {
    // Tiles gate their activation beacon on a trusted click, which a content
    // script can't forge. Instead we return the tile's on-screen center so the
    // background can dispatch a real click via the debugger (CDP Input).
    void (async () => {
      const section = sectionForActivityType(msg.activityType);
      const tiles = tileCount(section ? sectionEl(section.id) : null);
      const reply = (r: LocateResponse) => sendResponse(r);

      const card = resolveCard(msg);
      if (!card) {
        reply({
          status: LOCATE_STATUS.Absent,
          tiles,
          reason: `no card element for ${msg.title}`,
        });
        return;
      }
      const point = await locateElement(card);
      if (!point) {
        reply({ status: LOCATE_STATUS.Absent, tiles, reason: 'card not visible' });
        return;
      }
      reply({ status: LOCATE_STATUS.Ready, point, tiles, via: 'card' });
    })();
    return true;
  }

  if (msg.action === MSG_ACTION.LOCATE_CONTROL) {
    // Sections gate their tiles two ways: a disclosure toggle that renders no
    // cards at all until expanded, and (Keep earning) a "Show more" button that
    // pages in the rest. Both are located here and clicked by the background, so
    // they get the same humanized gesture every tile gets.
    //
    // Locate only — never click. And decide the status *before* measuring: only
    // the Ready branch may call locateElement, which scrolls. That keeps "already
    // expanded" a cheap, side-effect-free query, which is what lets the caller
    // poll it to confirm a click landed.

    // Standalone page controls (the points flyout) — no section context.
    if (msg.control === CONTROL_KIND.POINTS_TOGGLE) {
      void (async () => {
        const reply = (r: LocateResponse) => sendResponse(r);
        if (findBreakdownDialog()) {
          reply({ status: LOCATE_STATUS.Satisfied, tiles: 0, via: 'dialog-open' });
          return;
        }
        const found = findPointsToggle();
        if (!found) {
          reply({ status: LOCATE_STATUS.Absent, tiles: 0, reason: 'no "Today\'s points" toggle' });
          return;
        }
        const point = await locateElement(found.el);
        if (!point) {
          reply({ status: LOCATE_STATUS.Absent, tiles: 0, reason: 'points toggle not visible' });
          return;
        }
        reply({ status: LOCATE_STATUS.Ready, point, tiles: 0, via: found.via });
      })();
      return true;
    }
    if (msg.control === CONTROL_KIND.CLAIM_TOGGLE) {
      void (async () => {
        const reply = (r: LocateResponse) => sendResponse(r);
        if (findClaimDialog()) {
          reply({ status: LOCATE_STATUS.Satisfied, tiles: 0, via: 'dialog-open' });
          return;
        }
        const found = findClaimCard();
        if (!found) {
          reply({ status: LOCATE_STATUS.Absent, tiles: 0, reason: 'no "Ready to claim" card' });
          return;
        }
        const point = await locateElement(found.el);
        if (!point) {
          reply({ status: LOCATE_STATUS.Absent, tiles: 0, reason: 'claim card not visible' });
          return;
        }
        reply({ status: LOCATE_STATUS.Ready, point, tiles: 0, via: found.via });
      })();
      return true;
    }
    if (msg.control === CONTROL_KIND.CLAIM_CONFIRM) {
      void (async () => {
        const reply = (r: LocateResponse) => sendResponse(r);
        const dialog = findClaimDialog();
        if (!dialog) {
          // The orchestrator opens the flyout first — a missing dialog here is
          // a failed toggle click, not a satisfied state.
          reply({ status: LOCATE_STATUS.Absent, tiles: 0, reason: 'claim dialog not open' });
          return;
        }
        const confirm = findClaimConfirm(dialog);
        if (!confirm) {
          if (parseClaimFlyout(dialog).empty) {
            // Nothing left to claim — the empty state replaces the confirm
            // button, so a post-click re-poll lands here cheaply.
            reply({ status: LOCATE_STATUS.Satisfied, tiles: 0, via: 'empty-state' });
            return;
          }
          reply({
            status: LOCATE_STATUS.Absent,
            tiles: 0,
            reason: 'no "Claim points" button in dialog',
          });
          return;
        }
        const point = await locateElement(confirm);
        if (!point) {
          reply({ status: LOCATE_STATUS.Absent, tiles: 0, reason: 'claim button not visible' });
          return;
        }
        reply({ status: LOCATE_STATUS.Ready, point, tiles: 0, via: 'button-text' });
      })();
      return true;
    }
    if (msg.control === CONTROL_KIND.DIALOG_CLOSE) {
      void (async () => {
        const reply = (r: LocateResponse) => sendResponse(r);
        // Whichever flyout is open — they never coexist.
        const dialog = findBreakdownDialog() ?? findClaimDialog();
        if (!dialog) {
          // Nothing open — the desired state already holds.
          reply({ status: LOCATE_STATUS.Satisfied, tiles: 0, via: 'no-dialog' });
          return;
        }
        const closeBtn = findDialogClose(dialog);
        if (!closeBtn) {
          reply({ status: LOCATE_STATUS.Absent, tiles: 0, reason: 'no Close button in dialog' });
          return;
        }
        const point = await locateElement(closeBtn);
        if (!point) {
          reply({ status: LOCATE_STATUS.Absent, tiles: 0, reason: 'Close button not visible' });
          return;
        }
        reply({ status: LOCATE_STATUS.Ready, point, tiles: 0, via: 'aria-label' });
      })();
      return true;
    }

    if (msg.control !== CONTROL_KIND.SECTION_TOGGLE && msg.control !== CONTROL_KIND.SHOW_MORE) {
      return undefined; // exhaustive: page controls handled above
    }
    // TS doesn't carry parameter narrowing into the closure — alias the
    // section-scoped variant so `sectionKey` stays typed inside it.
    const sectionMsg = msg;
    void (async () => {
      const desc = sectionByKey(sectionMsg.sectionKey);
      const section = sectionEl(desc.id);
      const tiles = tileCount(section);
      const reply = (r: LocateResponse) => sendResponse(r);

      if (sectionMsg.control === CONTROL_KIND.SECTION_TOGGLE) {
        const found = resolveSectionToggle(section, desc);
        if (!found) {
          reply({
            status: LOCATE_STATUS.Absent,
            tiles,
            reason: `no disclosure toggle for section#${desc.id}`,
          });
          return;
        }
        if (found.el.getAttribute('aria-expanded') === 'true') {
          reply({ status: LOCATE_STATUS.Satisfied, tiles, via: found.via });
          return;
        }
        const point = await locateElement(found.el);
        if (!point) {
          reply({ status: LOCATE_STATUS.Absent, tiles, reason: 'section toggle not visible' });
          return;
        }
        reply({ status: LOCATE_STATUS.Ready, point, tiles, via: found.via });
        return;
      }

      // Show more. A section that isn't here, or has no button left, has no more
      // pages to reveal — that's Satisfied, not Absent.
      const showMore = section ? resolveShowMore(section) : null;
      if (!showMore) {
        reply({ status: LOCATE_STATUS.Satisfied, tiles, via: section ? 'text-scan' : 'none' });
        return;
      }
      const point = await locateElement(showMore);
      if (!point) {
        reply({ status: LOCATE_STATUS.Satisfied, tiles, via: 'text-scan' });
        return;
      }
      reply({ status: LOCATE_STATUS.Ready, point, tiles, via: 'text-scan' });
    })();
    return true;
  }

  if (msg.action === MSG_ACTION.READ_COUNTERS) {
    void (async () => {
      // The background just dispatched a trusted click on the "Today's points"
      // toggle; wait for the flyout to render, then parse its Bing-search row.
      // `read: false` + `detail` means "couldn't read — worth polling again";
      // the counter values are POINTS (fetch-counters divides into searches).
      const deadline = Date.now() + TIMEOUTS.FLYOUT_RENDER;
      let dialog = findBreakdownDialog();
      while (!dialog && Date.now() < deadline) {
        await sleep(TIMEOUTS.SECTION_CONFIRM_POLL);
        dialog = findBreakdownDialog();
      }

      let response: CountersResponse;
      if (!dialog) {
        response = {
          read: false,
          searchCounters: [],
          detail: '"Points breakdown" dialog did not open',
        };
      } else {
        const parsed = parsePointsBreakdown(dialog);
        response = parsed
          ? {
              read: true,
              searchCounters: [{ type: PC_SEARCH_TYPE, current: parsed.current, max: parsed.max }],
            }
          : {
              read: false,
              searchCounters: [],
              detail: 'no "Bing search" row in the points dialog',
            };
      }
      sendResponse(response);
    })();
    return true; // async sendResponse
  }

  if (msg.action === MSG_ACTION.READ_CLAIM) {
    void (async () => {
      // target 'card': the "Ready to claim" card's value on `/` (polled — the
      // SPA may still be hydrating after navigation). target 'flyout': the open
      // "Claim points" dialog's total/rows/empty state (polled — the background
      // just dispatched the trusted click that opens it).
      const deadline = Date.now() + TIMEOUTS.FLYOUT_RENDER;
      let response: ClaimReadResponse;

      if (msg.target === 'card') {
        let card = findClaimCard();
        while (!card && Date.now() < deadline) {
          await sleep(TIMEOUTS.SECTION_CONFIRM_POLL);
          card = findClaimCard();
        }
        if (!card) {
          response = { read: false, detail: 'no "Ready to claim" card on the page' };
        } else {
          const points = parseClaimCardPoints(card.el);
          response =
            points === null
              ? { read: false, detail: 'claim card value unreadable' }
              : { read: true, target: 'card', points };
        }
      } else {
        let dialog = findClaimDialog();
        while (!dialog && Date.now() < deadline) {
          await sleep(TIMEOUTS.SECTION_CONFIRM_POLL);
          dialog = findClaimDialog();
        }
        if (!dialog) {
          response = { read: false, detail: '"Claim points" dialog did not open' };
        } else {
          const parsed = parseClaimFlyout(dialog);
          // An unparsed total alongside a populated flyout is a failed read;
          // the empty state legitimately has nothing to parse.
          response =
            parsed.total === null && !parsed.empty
              ? { read: false, detail: 'claim flyout total unreadable' }
              : { read: true, target: 'flyout', ...parsed };
        }
      }
      sendResponse(response);
    })();
    return true; // async sendResponse
  }

  if (msg.action === MSG_ACTION.VALIDATE_ACTIVITY) {
    // Re-read the card's own badge in the DOM — resolved by the same matcher
    // the click used, so click and validate can't disagree about which tile is
    // meant. A card that isn't in the DOM is NotFound, which validate-activity
    // reports as an error rather than as an incomplete activity worth retrying.
    const card = resolveCard(msg);
    const response: ValidateActivityResponse = card
      ? { state: tileState(card), stateLabel: tileStateLabel(card) }
      : { state: CardState.NotFound };
    sendResponse(response);
    return undefined;
  }
  return undefined;
});
