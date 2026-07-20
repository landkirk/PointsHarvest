// Dashboard JSON API client — PC-search counters only.
//
// The endpoint (`/api/getuserinfo?type=1`) now 401s even for live sessions, so
// extraction, login detection, and validation all read the DOM instead (see
// content/rewards-dom.ts). This client survives only to feed GET_COUNTERS
// until the counter's DOM port (the "Points breakdown" flyout on /earn) lands,
// at which point this file is deleted.
//
// `fetchDashboard` must run in a rewards.bing.com context (content script) so
// the request is same-origin and carries the user's cookies.

import { PC_SEARCH_TYPE, REWARDS_API_PATH } from './config.js';

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
 * Fetch and parse the dashboard JSON, or `null` if it couldn't be read for any
 * reason (network failure, 401/403, sign-in redirect, non-JSON body).
 */
export async function fetchDashboard(): Promise<Dashboard | null> {
  try {
    // `no-store`: counter polls re-fetch this endpoint expecting to see state
    // *change*; a cached response would freeze them. `redirect: 'manual'`: a
    // logged-out request 302s to the cross-origin sign-in host, which under
    // 'follow' rejects on CORS — 'manual' keeps it a readable non-OK response.
    const res = await fetch(REWARDS_API_PATH, {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'manual',
    });
    if (!res.ok) return null;
    const text = await res.text();
    // A same-origin logged-out request serves the HTML login page, not a 401.
    if (text.trim().startsWith('<')) return null;
    const json = JSON.parse(text) as DashboardResponse;
    return json.dashboard ?? null;
  } catch {
    return null;
  }
}

/** Pick the real PC-search counter; pcSearch[] may also carry bonus/mobile entries. */
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
