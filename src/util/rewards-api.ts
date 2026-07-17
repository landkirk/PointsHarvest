// Dashboard JSON API client + mappers.
//
// rewards.bing.com exposes an authenticated, same-origin JSON endpoint
// (`/api/getuserinfo?type=1`) that predates the 2026 front-end rewrite and
// returns everything the extension needs: activities, completion state, and
// search counters. Making this the source of truth (instead of scraping the DOM)
// is what keeps extraction immune to re-skins — the rewrite broke every selector
// the extension had, and this endpoint was unaffected. See
// REWARDS-REDESIGN-PLAN.md §3–4.
//
// `fetchDashboard` must run in a rewards.bing.com context (content script) so
// the request is same-origin and carries the user's cookies.

import { PC_SEARCH_TYPE, REWARDS_API_PATH } from './config.js';
import { CardState, CARD_SOURCE } from './activity-types.js';
import type { RawCard, CardSource } from './activity-types.js';

// ── API response shape (only the fields we consume) ────────────────────────

interface DashboardPromotion {
  name?: string;
  promotionType?: string;
  complete?: boolean;
  pointProgress?: number;
  pointProgressMax?: number;
  destinationUrl?: string;
  attributes?: Record<string, string | undefined>;
}

interface DashboardCounters {
  pcSearch?: DashboardPromotion[];
  [key: string]: DashboardPromotion[] | undefined;
}

export interface Dashboard {
  userStatus?: { counters?: DashboardCounters };
  dailySetPromotions?: Record<string, DashboardPromotion[]>;
  morePromotions?: DashboardPromotion[];
}

interface DashboardResponse {
  dashboard?: Dashboard;
}

/**
 * Outcome of a dashboard fetch. The three cases are deliberately distinct:
 * `logged-out` is *proof* of no session, while `error` is inconclusive — it says
 * nothing about whether the user is signed in. Collapsing the two lets a caller
 * read a network blip as a session (or vice versa), so they stay separate here
 * and the caller decides what an inconclusive result means.
 */
export type DashboardResult =
  | { status: 'ok'; dashboard: Dashboard }
  | { status: 'logged-out' }
  // `detail` names the failure (threw, non-OK HTTP status, missing `dashboard`
  // field) so a caller that reports "not logged in" can say why the read failed.
  | { status: 'error'; detail: string };

/**
 * Fetch and parse the dashboard JSON, reporting *why* it failed.
 *
 * A logged-out (or stale-token) request 302s to the Microsoft OIDC sign-in host.
 * `redirect: 'manual'` turns that cross-origin bounce into an *opaque redirect*
 * response (`type: 'opaqueredirect'`, `status: 0`) instead of letting `fetch`
 * follow it into a CORS rejection — so we can read it as a definitive
 * `logged-out` here rather than a generic network `error`. (Under the default
 * `redirect: 'follow'` this same case rejects on CORS and is indistinguishable
 * from a network failure.)
 */
export async function fetchDashboardResult(): Promise<DashboardResult> {
  try {
    // `no-store`: counter polls and post-click validation re-fetch this endpoint
    // expecting to see state *change*; a cached response would freeze them.
    // `redirect: 'manual'`: see the JSDoc — a sign-in redirect must surface as
    // logged-out, not as a thrown CORS error.
    const res = await fetch(REWARDS_API_PATH, {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'manual',
    });
    // A redirect to the sign-in host: the request carried no valid session/token.
    if (res.type === 'opaqueredirect') return { status: 'logged-out' };
    if (res.status === 401 || res.status === 403) return { status: 'logged-out' };
    if (!res.ok) return { status: 'error', detail: `HTTP ${res.status} ${res.statusText}` };
    const text = await res.text();
    // A same-origin logged-out request serves the HTML login page, not a 401.
    if (text.trim().startsWith('<')) return { status: 'logged-out' };
    let json: DashboardResponse;
    try {
      json = JSON.parse(text) as DashboardResponse;
    } catch {
      return { status: 'error', detail: `response was not JSON (${text.length} chars)` };
    }
    return json.dashboard
      ? { status: 'ok', dashboard: json.dashboard }
      : { status: 'error', detail: 'JSON had no `dashboard` field' };
  } catch (err) {
    // fetch() rejects on network failure or a cross-origin redirect that fails CORS
    // (the shape a logged-out redirect to the sign-in host takes) — see the note above.
    return {
      status: 'error',
      detail: `fetch threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Dashboard data, or `null` if it couldn't be read for any reason. For callers
 * that only need the data — use `fetchDashboardResult` where the difference
 * between "logged out" and "couldn't tell" changes what you do next.
 */
export async function fetchDashboard(): Promise<Dashboard | null> {
  const result = await fetchDashboardResult();
  return result.status === 'ok' ? result.dashboard : null;
}

// ── Mapping: Dashboard → RawCard[] ─────────────────────────────────────────

const EXPLORE_PROMO_MARKER = 'exploreonbing';
// Some promo titles carry zero-width characters (U+200B–U+200D, U+FEFF).
// Escapes keep the source pure ASCII (no invisible bytes).
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

/**
 * Strip zero-width characters and collapse all whitespace runs (including NBSP
 * and newlines from wrapped markup) to single spaces. Both sides of every title
 * comparison go through this, so a DOM title rendered with U+00A0 still equals
 * the API title it came from.
 */
export function clean(text: string | undefined): string {
  return (text ?? '').replace(ZERO_WIDTH_RE, '').replace(/\s+/g, ' ').trim();
}

/** Local calendar date as the `MM/DD/YYYY` key used by `dailySetPromotions`. */
export function todayDateKey(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${now.getFullYear()}`;
}

/** Today's daily set; falls back to the chronologically earliest key present. */
function selectTodayDailySet(
  map: Record<string, DashboardPromotion[]> | undefined,
): DashboardPromotion[] {
  if (!map) return [];
  const today = map[todayDateKey()];
  if (today) return today;
  const keys = Object.keys(map).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return keys.length > 0 ? (map[keys[0]] ?? []) : [];
}

function isExplorePromo(promo: DashboardPromotion): boolean {
  const name = (promo.name ?? '').toLowerCase();
  const offerId = (promo.attributes?.offerid ?? '').toLowerCase();
  return name.includes(EXPLORE_PROMO_MARKER) || offerId.includes(EXPLORE_PROMO_MARKER);
}

function cardState(
  promo: DashboardPromotion,
  attrs: Record<string, string | undefined>,
): CardState {
  if (promo.complete) return CardState.Completed;
  // Explore/level-up tiles unlock on a schedule (attributes.is_unlocked === "False"
  // with locked_category_criteria e.g. "tomorrow"); they can't be done today.
  if (attrs.is_unlocked === 'False') return CardState.Locked;
  return CardState.Actionable;
}

function promoToRawCard(promo: DashboardPromotion, id: string, source: CardSource): RawCard {
  const attrs = promo.attributes ?? {};
  return {
    id,
    title: clean(attrs.title),
    description: clean(attrs.description),
    points: promo.pointProgressMax ?? 0,
    cardState: cardState(promo, attrs),
    source,
    promoName: promo.name ?? '',
    destinationUrl: promo.destinationUrl ?? attrs.destination ?? '',
  };
}

/**
 * Completion state of a promo, looked up by its `name` across every promo
 * collection (daily sets of any date, more/explore promotions). Returns `null`
 * when no promo with that name exists — callers treat that as "unknown".
 * This is the API-based replacement for DOM badge inspection during validation.
 */
export function promoComplete(dashboard: Dashboard, promoName: string): boolean | null {
  if (!promoName) return null;
  const all: DashboardPromotion[] = [
    ...Object.values(dashboard.dailySetPromotions ?? {}).flat(),
    ...(dashboard.morePromotions ?? []),
  ];
  const match = all.find((p) => p.name === promoName);
  return match ? Boolean(match.complete) : null;
}

/** Pick the real PC-search counter; pcSearch[] may also carry bonus/mobile entries (plan §7 Q3). */
function selectPcSearchEntry(entries: DashboardPromotion[]): DashboardPromotion | undefined {
  return entries.find((e) => (e.attributes?.type ?? '').toLowerCase() === 'search') ?? entries[0];
}

/**
 * Map the dashboard's pcSearch counter to the GET_COUNTERS response shape.
 * `current`/`max` are POINTS — fetch-counters divides by PC_SEARCH_POINTS_PER_SEARCH.
 * Returns `[]` (not a zero-max counter) when the dashboard has no live counter;
 * the GET_COUNTERS reply's `read` flag tells callers this was a definitive read,
 * not a failed one.
 */
export function mapDashboardToCounters(
  dashboard: Dashboard,
): { type: string; current: number; max: number }[] {
  const pc = selectPcSearchEntry(dashboard.userStatus?.counters?.pcSearch ?? []);
  if (!pc) return [];
  const current = pc.pointProgress ?? 0;
  const max = pc.pointProgressMax ?? 0;
  if (max <= 0) return [];
  return [{ type: PC_SEARCH_TYPE, current, max }];
}

/**
 * Flatten a dashboard into the `RawCard[]` the extraction orchestrator expects.
 * Ids are `D`/`E`/`M` section prefixes plus an index — a human-readable handle
 * for logs and the debug panel, not a join key. The real join key for clicking
 * and validating is `promoName`.
 */
export function mapDashboardToCards(dashboard: Dashboard): RawCard[] {
  const cards: RawCard[] = [];

  selectTodayDailySet(dashboard.dailySetPromotions).forEach((promo, i) => {
    cards.push(promoToRawCard(promo, `D${i + 1}`, CARD_SOURCE.DAILY_SET));
  });

  let exploreIndex = 0;
  let moreIndex = 0;
  for (const promo of dashboard.morePromotions ?? []) {
    if (isExplorePromo(promo)) {
      cards.push(promoToRawCard(promo, `E${++exploreIndex}`, CARD_SOURCE.EXPLORE));
    } else {
      cards.push(promoToRawCard(promo, `M${++moreIndex}`, CARD_SOURCE.MORE_ACTIVITIES));
    }
  }

  return cards;
}
