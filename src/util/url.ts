/**
 * Canonical key for URL equality: origin + pathname (no trailing slash),
 * lowercased — plus the query string when `withQuery` is set. Falls back to the
 * raw string lowercased when it doesn't parse.
 *
 * The origin matters: a tab that drifted off rewards.bing.com (a sign-in
 * redirect on session expiry) still matches on path alone — `/` is `/` on every
 * host — so a pathname-only comparison would misread "somewhere else entirely"
 * as "already there".
 *
 * One helper for both comparisons in the codebase — page identity (query
 * ignored: `?form=...` noise must not force a reload) and card-href matching
 * (query kept: daily-set hrefs embed the promo in BTDSUOID/filter params) — so
 * the two can't drift apart.
 */
export function urlKey(u: string, opts: { withQuery?: boolean; base?: string } = {}): string {
  try {
    const url = new URL(u, opts.base);
    const path = url.pathname.replace(/\/$/, '');
    return (url.origin + path + (opts.withQuery ? url.search : '')).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}
