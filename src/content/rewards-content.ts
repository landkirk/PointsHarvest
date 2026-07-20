// Injected into rewards.bing.com. Message router for the rewards dashboard.
//
// The background confirms readiness and login state through the REWARDS_STATUS
// probe (DOM heuristic — the dashboard API 401s even for live sessions, so it
// is no longer consulted). The DOM is also touched to *locate* a card so the
// background can click it, and to expand the sections that render their tiles
// lazily. Counters and validation still read the API pending their DOM ports.

import { CardState, sectionByKey, sectionForActivityType } from '../util/activity-types.js';
import type { ActivityType, SectionDescriptor } from '../util/activity-types.js';
import { TIMEOUTS, sleep } from '../util/timing.js';
import { CONTROL_KIND, LOCATE_STATUS, MSG_ACTION } from '../util/messaging.js';
import type {
  AppMessage,
  ClickPoint,
  CountersResponse,
  LocateResponse,
  RewardsStatusResponse,
} from '../util/messaging.js';
import {
  clean,
  fetchDashboard,
  mapDashboardToCounters,
  promoComplete,
} from '../util/rewards-api.js';
import { urlKey } from '../util/url.js';

// The header renders a bare "Sign in" control beside the account avatar when
// there's no session (signed in, it shows the account name instead), and carries
// no marketing copy that text sniffing could catch. Match on an element whose
// *entire* text is "Sign in" so ordinary prose containing the words can't trip it.
const SIGN_IN_LABEL = /^sign in$/i;

/**
 * Only a control the user can actually see counts. Headers routinely render both
 * auth states and toggle between them with CSS, and the SPA can paint a signed-out
 * skeleton before the session hydrates — so a text match alone reports a signed-in
 * user as logged out, which ends their run with "Not logged in".
 */
function isVisible(el: HTMLElement): boolean {
  // checkVisibility covers display/visibility/content-visibility; the rect check
  // is the floor (also catches detached and zero-size nodes).
  if (el.getClientRects().length === 0) return false;
  return el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? true;
}

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
// lowercasing, so DOM titles compare equal to the cleaned API titles.
function cleanText(s: string): string {
  return clean(s).toLowerCase();
}

/** Every card is an anchor; shared so the tile *count* and the tile *lookup* can't drift. */
const TILE_SELECTOR = 'a[href]';

function sectionEl(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`section#${CSS.escape(id)}`);
}

/**
 * Cards currently rendered in a section — the measure of whether its phase can
 * run at all. Deliberately does NOT fall back to the document like `cardAnchors`
 * does: a document-wide count would report tiles for a section that isn't even
 * on the page, which is exactly the state callers use this to detect.
 */
function tileCount(section: HTMLElement | null): number {
  return section ? section.querySelectorAll(TILE_SELECTOR).length : 0;
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

// Primary matcher: locate the card anchor by its title. Explore tiles all share
// ONE destinationUrl, so the title (unique per tile) is the only reliable key.
// Matches the img[alt], then the title <p>, then the anchor text.
function findCardByTitle(
  title: string,
  anchors: HTMLAnchorElement[],
): HTMLAnchorElement | undefined {
  const want = cleanText(title);
  if (!want) return undefined;
  return (
    anchors.find((a) => cleanText(a.querySelector('img')?.alt ?? '') === want) ??
    anchors.find((a) => cleanText(a.querySelector('p')?.textContent ?? '') === want) ??
    anchors.find((a) => cleanText(a.textContent ?? '').startsWith(want))
  );
}

// Origin + path + query, lowercased — a stable key for comparing a card's live
// href against the API's destinationUrl regardless of fragment or casing.
function normalizeHref(u: string): string {
  return urlKey(u, { withQuery: true, base: location.href });
}

/**
 * Fallback matcher, used when title matching misses.
 *
 * The promo name is tried FIRST because it is the only discriminating key here:
 * every explore tile shares one destinationUrl (the Bing homepage), so a URL
 * match against an explore card cannot say WHICH tile is meant. The name is
 * embedded in the href for the cards that carry it (daily-set BTDSUOID / filter
 * params); destinationUrl is the last resort, and only counts when it matches
 * exactly one anchor — on a shared href, reporting the card absent beats
 * silently clicking (and crediting) the wrong tile.
 *
 * Returns undefined when the card isn't in the DOM.
 */
function findCardByDestination(
  destinationUrl: string,
  promoName: string,
  anchors: HTMLAnchorElement[],
): HTMLAnchorElement | undefined {
  if (!destinationUrl && !promoName) return undefined;

  if (promoName) {
    const byName = anchors.find((a) => {
      try {
        return decodeURIComponent(a.href).includes(promoName);
      } catch {
        return a.href.includes(promoName);
      }
    });
    if (byName) return byName;
  }
  if (destinationUrl) {
    const target = normalizeHref(destinationUrl);
    const matches = anchors.filter((a) => normalizeHref(a.href) === target);
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

/** Resolve an activity to its anchor: by title, then by promo name / destination. */
function resolveCard(msg: {
  title: string;
  destinationUrl: string;
  promoName: string;
  activityType: ActivityType;
}): HTMLAnchorElement | undefined {
  const anchors = cardAnchors(msg.activityType);
  return (
    findCardByTitle(msg.title, anchors) ??
    findCardByDestination(msg.destinationUrl, msg.promoName, anchors)
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
          reason: `no card element for ${msg.title || msg.promoName}`,
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
    void (async () => {
      const desc = sectionByKey(msg.sectionKey);
      const section = sectionEl(desc.id);
      const tiles = tileCount(section);
      const reply = (r: LocateResponse) => sendResponse(r);

      if (msg.control === CONTROL_KIND.SECTION_TOGGLE) {
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

  if (msg.action === MSG_ACTION.GET_COUNTERS) {
    void (async () => {
      // The API is the only counter source, and the DOM has none: the old counter
      // markup lived solely on /pointsbreakdown, which is gone (it redirects to a
      // page with no live counter). `read: false` means "couldn't read the
      // dashboard — poll again"; `read: true` with no counters is a definitive
      // "this account has no live counter" and callers must not keep polling.
      const dashboard = await fetchDashboard();
      const response: CountersResponse = dashboard
        ? { read: true, searchCounters: mapDashboardToCounters(dashboard) }
        : { read: false, searchCounters: [] };
      sendResponse(response);
    })();
    return true; // async sendResponse
  }

  if (msg.action === MSG_ACTION.VALIDATE_ACTIVITY) {
    void (async () => {
      // Read the promo's `complete` flag by name. Works from any rewards page and
      // needs no card on screen. A promo the dashboard doesn't know about is
      // NotFound, which validate-activity reports as an error rather than as an
      // incomplete activity worth retrying.
      if (msg.promoName) {
        const dashboard = await fetchDashboard();
        const complete = dashboard ? promoComplete(dashboard, msg.promoName) : null;
        if (complete !== null) {
          sendResponse({ state: complete ? CardState.Completed : CardState.Actionable });
          return;
        }
      }
      sendResponse({ state: CardState.NotFound });
    })();
    return true;
  }
  return undefined;
});
