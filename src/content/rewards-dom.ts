// DOM parsing for the redesigned (2026) rewards.bing.com — React + react-aria +
// Tailwind design tokens. Runs inside the rewards content script (esbuild
// inlines this module into rewards-content; it is not a separate bundle) and
// replaces the dashboard JSON API, which now 401s even for live sessions.
//
// Selector ground rules, verified against live DOM captures:
// - `section#<id>` semantic ids are the only durable anchors; react-aria ids
//   are random per render and Tailwind utility classes are layout noise. The
//   token classes used below (`text-globalBody2Strong`, …) are design tokens,
//   semi-stable across deploys — every read still has a structural fallback.
// - Tiles are `a[href]` anchors. Title lives in `img[alt]` and the strong
//   `<p>`; description in the secondary `<p>`.
// - Actionable tiles carry a `+N` badge; completed tiles a success pill
//   (checkmark + bare number) plus a trailing "Completed" metadata label.
//   Explore tiles read "Activated" between the click and the credit landing —
//   that is NOT complete. Image-overlay icons change per state while the tile
//   stays actionable, so they are never read for state.

import { CardState, CARD_SOURCE, SECTION } from '../util/activity-types.js';
import type { CardSource, RawCard, SectionKey } from '../util/activity-types.js';

// Some titles carry zero-width characters (U+200B–U+200D, U+FEFF).
// Escapes keep the source pure ASCII (no invisible bytes).
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

/**
 * Strip zero-width characters and collapse all whitespace runs (including NBSP
 * and newlines from wrapped markup) to single spaces. Both sides of every title
 * comparison go through this, so a DOM title rendered with U+00A0 still equals
 * the extraction-time title it came from.
 */
export function clean(text: string | undefined | null): string {
  return (text ?? '').replace(ZERO_WIDTH_RE, '').replace(/\s+/g, ' ').trim();
}

/**
 * Only a control the user can actually see counts. Headers routinely render
 * both auth states and toggle between them with CSS, and the SPA can paint
 * hidden skeletons — a text match alone lands on invisible markup.
 */
export function isVisible(el: HTMLElement): boolean {
  // checkVisibility covers display/visibility/content-visibility; the rect check
  // is the floor (also catches detached and zero-size nodes).
  if (el.getClientRects().length === 0) return false;
  return el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? true;
}

/** Every card is an anchor; shared so the tile *count* and the tile *lookup* can't drift. */
export const TILE_SELECTOR = 'a[href]';

export function sectionEl(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`section#${CSS.escape(id)}`);
}

/**
 * Cards currently rendered in a section — the measure of whether its phase can
 * run at all. Deliberately does NOT fall back to the document like `cardAnchors`
 * does: a document-wide count would report tiles for a section that isn't even
 * on the page, which is exactly the state callers use this to detect.
 */
export function tileCount(section: HTMLElement | null): number {
  return section ? section.querySelectorAll(TILE_SELECTOR).length : 0;
}

// Badge/label token classes (see the live-capture notes in the header).
const SUCCESS_BADGE_SELECTOR = '.bg-statusSuccessRewardsBg';
const ACTIONABLE_POINTS_SELECTOR = 'p.text-statusInformativeTintFg';
const TITLE_SELECTOR = 'p.text-globalBody2Strong';
const DESCRIPTION_SELECTOR = 'p.text-fgCtrlNeutralSecondaryRest';
const METADATA_SELECTOR = '.text-metadata';

function tileTitle(tile: HTMLAnchorElement): string {
  return (
    clean(tile.querySelector('img')?.alt) ||
    clean(tile.querySelector(TITLE_SELECTOR)?.textContent) ||
    clean(tile.querySelector('p')?.textContent)
  );
}

function tileDescription(tile: HTMLAnchorElement): string {
  return (
    clean(tile.querySelector(DESCRIPTION_SELECTOR)?.textContent) ||
    clean(tile.querySelectorAll('p')[1]?.textContent)
  );
}

/**
 * The tile's trailing state label ("Completed", "Activated"), '' when none.
 * Rendered as a `.text-metadata` element of no fixed tag (a `div` in captures);
 * the points badges share that class, so bare numbers are skipped.
 */
export function tileStateLabel(tile: Element): string {
  for (const el of Array.from(tile.querySelectorAll<HTMLElement>(METADATA_SELECTOR))) {
    const text = clean(el.textContent);
    if (text && !/^\+?\s*[\d,]+$/.test(text)) return text;
  }
  return '';
}

/**
 * A tile's completion state. Completed = the success pill (primary) or a
 * trailing "Completed" label (fallback). Everything else — including an explore
 * tile's "Activated" (armed, points not yet credited) — is Actionable.
 * `Locked` no longer occurs: the site simply doesn't render future tiles.
 */
export function tileState(tile: Element): CardState {
  if (tile.querySelector(SUCCESS_BADGE_SELECTOR)) return CardState.Completed;
  if (/\bcompleted\b/i.test(tileStateLabel(tile))) return CardState.Completed;
  return CardState.Actionable;
}

/**
 * Points from the tile's badge: `+N` while actionable, a bare number in the
 * success pill once completed (read via textContent — the pill's text node can
 * carry an HTML comment). `null` when the tile has no badge at all, which marks
 * a 0-point quest/informational promo — the DOM equivalent of the API's
 * `pointProgressMax === 0`, and the caller's signal to skip the tile.
 */
export function tilePoints(tile: Element): number | null {
  const plus = clean(tile.querySelector(ACTIONABLE_POINTS_SELECTOR)?.textContent);
  const plusMatch = plus.match(/^\+\s*(\d+)$/);
  if (plusMatch) return Number(plusMatch[1]);

  const done = clean(tile.querySelector(`${SUCCESS_BADGE_SELECTOR} p`)?.textContent);
  const doneMatch = done.match(/^(\d+)$/);
  if (doneMatch) return Number(doneMatch[1]);

  // Structural fallback for token-class drift: a bare-number metadata text.
  // Scoped to metadata elements so digits in descriptions can't match.
  for (const el of Array.from(tile.querySelectorAll<HTMLElement>(METADATA_SELECTOR))) {
    const m = clean(el.textContent).match(/^\+?\s*(\d+)$/);
    if (m) return Number(m[1]);
  }
  return null;
}

const SOURCE_BY_KEY: Record<SectionKey, CardSource> = {
  dailySet: CARD_SOURCE.DAILY_SET,
  exploreOnBing: CARD_SOURCE.EXPLORE,
  moreActivities: CARD_SOURCE.MORE_ACTIVITIES,
};

// Human-readable log handles (`D1`, `E2`, …) — not a join key; matching keys
// on title-within-section with the href as tie-break.
const ID_PREFIX: Record<SectionKey, string> = {
  dailySet: 'D',
  exploreOnBing: 'E',
  moreActivities: 'M',
};

export interface SectionParseResult {
  cards: RawCard[];
  /** Raw anchor count in the section — includes tiles skipped as badge-less. */
  tiles: number;
  warnings: string[];
}

/** Parse one section's tiles into RawCards. Pure DOM read — no waiting; callers poll. */
export function parseSectionCards(key: SectionKey): SectionParseResult {
  const desc = SECTION[key];
  const section = sectionEl(desc.id);
  if (!section) {
    return { cards: [], tiles: 0, warnings: [`section#${desc.id} not in the DOM`] };
  }

  const anchors = Array.from(section.querySelectorAll<HTMLAnchorElement>(TILE_SELECTOR));
  const cards: RawCard[] = [];
  const warnings: string[] = [];
  const titleCounts = new Map<string, number>();

  for (const tile of anchors) {
    const title = tileTitle(tile);
    const points = tilePoints(tile);
    if (points === null) {
      // Badge-less quest/promo tiles often carry a relative same-tab href —
      // clicking one would hijack the rewards tab on top of earning nothing.
      warnings.push(
        `skipped badge-less tile "${title || tile.getAttribute('href') || '?'}" in ${desc.label}`,
      );
      continue;
    }
    cards.push({
      id: `${ID_PREFIX[key]}${cards.length + 1}`,
      title,
      description: tileDescription(tile),
      points,
      cardState: tileState(tile),
      source: SOURCE_BY_KEY[key],
      // The resolved absolute href — quest tiles use relative href attributes.
      destinationUrl: tile.href,
    });
    const dupKey = title.toLowerCase();
    titleCounts.set(dupKey, (titleCounts.get(dupKey) ?? 0) + 1);
  }

  for (const [title, n] of titleCounts) {
    if (n > 1) {
      warnings.push(
        `duplicate title "${title}" ×${n} in ${desc.label} — matching tie-breaks on href`,
      );
    }
  }

  return { cards, tiles: anchors.length, warnings };
}

// ── "Points breakdown" flyout (PC search counter) ───────────────────────────
//
// The redesigned site renders no inline counter anywhere; the only DOM source
// is the "Today's points" card on /earn, whose click opens a side flyout —
// `section[role="dialog"]` titled "Points breakdown" — holding a
// "Bing search" row like `35/100 50` (current / cap, then the struck-through
// pre-2X cap, which the slash pattern never matches).

const POINTS_TOGGLE_RE = /today'?s points/i;
const BREAKDOWN_TITLE_RE = /points breakdown/i;
const BING_SEARCH_ROW_RE = /^bing search$/i;

/**
 * The "Today's points" flyout toggle: a card-style `button[aria-expanded]`
 * whose text/img[alt] carries the label. Falls back to a visible-clickable
 * text scan if the button shape drifts.
 */
export function findPointsToggle(): { el: HTMLElement; via: string } | null {
  const byButton = Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'),
  ).find(
    (b) =>
      isVisible(b) &&
      (POINTS_TOGGLE_RE.test(clean(b.textContent)) ||
        POINTS_TOGGLE_RE.test(clean(b.querySelector('img')?.alt))),
  );
  if (byButton) return { el: byButton, via: 'aria-expanded' };

  const byText = Array.from(
    document.querySelectorAll<HTMLElement>('button, a, [role="button"]'),
  ).find((el) => POINTS_TOGGLE_RE.test(clean(el.textContent)) && isVisible(el));
  return byText ? { el: byText, via: 'text-scan' } : null;
}

/**
 * The open "Points breakdown" dialog, or null. Resolved by the dialog's own
 * heading — never by a document-wide text search, because the *closed* toggle
 * also contains the words "Points breakdown".
 */
export function findBreakdownDialog(): HTMLElement | null {
  for (const dlg of Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))) {
    const labelledBy = dlg.getAttribute('aria-labelledby');
    const heading =
      (labelledBy ? document.getElementById(labelledBy)?.textContent : null) ??
      dlg.querySelector('h2')?.textContent;
    if (BREAKDOWN_TITLE_RE.test(clean(heading))) return dlg;
  }
  return null;
}

/** The dialog's Close control (header `button[aria-label="Close"]`, else the footer Close). */
export function findDialogClose(dialog: HTMLElement): HTMLElement | null {
  return (
    dialog.querySelector<HTMLElement>('button[aria-label="Close"]') ??
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      /^close$/i.test(clean(b.textContent)),
    ) ??
    null
  );
}

/**
 * The Bing-search row's points, in POINTS (fetch-counters divides into
 * searches). The value cell is the next sibling of the label cell; commas are
 * stripped so the pattern survives locale formatting.
 */
export function parsePointsBreakdown(dialog: HTMLElement): { current: number; max: number } | null {
  const label = Array.from(dialog.querySelectorAll<HTMLElement>('p')).find((p) =>
    BING_SEARCH_ROW_RE.test(clean(p.textContent)),
  );
  const cell = label?.closest('div')?.nextElementSibling;
  const m = clean(cell?.textContent).match(/([\d,]+)\s*\/\s*([\d,]+)/);
  if (!m) return null;
  const num = (s: string) => Number(s.replace(/,/g, ''));
  return { current: num(m[1]), max: num(m[2]) };
}
