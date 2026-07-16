# Bing Rewards Redesign — Findings & Migration Plan

**Date researched:** 2026-07-15 (live, logged-in session against rewards.bing.com)
**Status:** Implemented on `dashboard-redesign`. Legacy-dashboard support has since been **removed** — the redesign path is the only path, §5 (the A/B seam and its removal checklist) is gone, and what it described no longer exists in the code. **Still not validated against the live site**; §10 records the defects that remain open. Not released.
**Audience:** This document is the research record for the rewrite. Everything in the "Verified findings" sections was confirmed live against the real site — do not re-derive it, but DO re-verify anything marked ⚠️ before relying on it, and treat §2's unverified claims with suspicion (§10 records two that turned out to be wrong).

---

## 1. Summary

rewards.bing.com shipped a complete front-end rewrite (React + react-aria + Tailwind). **Every CSS selector the extension uses on rewards.bing.com now matches zero elements.** Additionally:

- Daily sets remain on the home page (`https://rewards.bing.com/`), but **Explore on Bing and More Activities moved to a subpage: `https://rewards.bing.com/earn`**.
- The `/pointsbreakdown` page (used for PC search counters) **no longer exists** — it redirects to `/dashboard?modal=membership`, which contains **no live counter**.
- The internal JSON API (`/api/getuserinfo?type=1`) **still works and exposes everything we scrape, more reliably**.

**Core recommendation:** make the API the source of truth for *extraction, validation, and counters*. Use the DOM only for the human-like card clicks.

At the time of research the redesign looked A/B-flighted (the new dashboard advertises "See your new dashboard" to users), so the original plan carried both layouts behind an adapter seam. The rollout has since completed and that seam has been deleted — the sections below describe the redesign only.

---

## 2. Verified findings — new site structure

### 2.1 Old selectors: all dead

From [src/content/rewards-content.ts](src/content/rewards-content.ts) `SELECTORS`, tested live on the new home page — **every one returned 0 matches**:

| Selector | Old purpose | New status |
|---|---|---|
| `#daily-sets` | daily set container | gone → `section#dailyset` |
| `#more-activities` | more activities container | gone → `section#moreactivities` **on /earn** |
| `a.ds-card-sec` | actionable card | gone → plain `<a data-rac>` (react-aria) |
| `.locked-card` | locked (future) card | gone entirely — future daily sets are simply not rendered |
| `[aria-label="Points you have earned"]` | completed marker | gone → "Completed" text badge (see 2.4) |
| `[aria-label="Points in progress"]` / `"Points you will earn"` | actionable marker | gone → "+N" points badge (see 2.4) |
| `[data-bi-id]` | explore-on-bing detection | gone — no `data-bi-id` anywhere |
| `.pointsBreakdownCard`, `.title-detail p`, `p.pointsDetail` | search counters | gone — whole page gone |
| `.contentContainer p`, `.pointsString` | card description/points | gone |

Cards no longer carry `aria-label` at all. Class names are Tailwind utility + design-token classes (e.g. `text-globalBody2Strong`, `text-statusInformativeTintFg`). React-aria element ids (`#react-aria-_R_...`) are **random per render — never use them**.

### 2.2 New page layout

**Home `https://rewards.bing.com/`** — `<main>` contains `<section>` elements with **stable, semantic ids** (best DOM anchors available):

- `section#offers` — promo banners / bonus cards (buttons, mostly ignorable)
- `section#snapshot` — "Your progress": daily streak, stamp bonus, goal. No search counter.
- `section#dailyset` — **the 3 daily set cards** (today only; tomorrow's set is not rendered)
- `section#streaks`, `section#redeem`, `section#achievements`

**Earn page `https://rewards.bing.com/earn`** — sections:

- `section#streaks`
- `section#exploreonbing` — Explore on Bing cards. Not paginated: every offer renders in the section.
- `section#levelup` — "Level up activities" (new; 6 cards; untapped point source, out of scope for v1)
- `section#quests` — "Quests" (new; 8 cards; out of scope for v1)
- `section#moreactivities` — "Keep earning" (the old More Activities; 16 cards observed). **The only paginated section:** it renders a preview row plus a "Show more" control that must be tripped before the rest are in the DOM.
- `section#microsoft` — external "ways to earn" links (ignore)

Each section wraps content in `.react-aria-Disclosure` → `.react-aria-DisclosurePanel` → grid of cards.

### 2.3 New card markup

Cards are plain `<a>` (or `<button>` for non-link promos) with `data-rac` and `data-react-aria-pressable="true"`. Observed daily-set card:

```
<a data-rac data-react-aria-pressable="true"
   href="https://www.bing.com/search?q=Events+near+me&form=ML2X97&...&BTDSUOID%3A%22Gamification_DailySet_20260715_Child1%22">
  <div> <img alt="Upcoming events near me"> ... </div>
  <p class="... text-globalBody2Strong">Upcoming events near me</p>          ← title
  <p class="... text-fgCtrlNeutralSecondaryRest">Exciting sports, ...</p>    ← description
  <div>…points badge…</div>
</a>
```

Key facts:

- **The `href` equals the promo's `destinationUrl` from the API** (verified: daily set and explore card hrefs matched API destinations exactly). This is the reliable join key between API data and DOM elements.
- Title = first `p.text-globalBody2Strong` inside the card; description = `p.text-fgCtrlNeutralSecondaryRest`. The `img[alt]` also carries the title.
- Explore on Bing card descriptions still read "Search on Bing to …", so the existing `EXPLORE_ON_BING_RE` in [src/util/activity.ts](src/util/activity.ts) still matches as a *fallback*; primary classification should come from the API (Section 3).
- Explore-on-bing hrefs go to the **Bing homepage** with `rwAutoFlyout=exb` (`https://www.bing.com/?form=ML2PCR&...&rwAutoFlyout=exb`) — not to a search URL. The extension's existing flow (open tab → send `PERFORM_SEARCH` to fill the Bing search box) still fits.
- ✅ **Answered (2026-07-16):** clicking a card **opens a new tab**, as the old design did. `TabManager.clickCardAndCaptureTab`'s capture model is correct as written and needs no same-tab fallback.

### 2.4 Card state signals (new design)

- **Actionable:** points badge `<p class="text-metadata ... text-statusInformativeTintFg">+ 10</p>` (renders as "+10").
- **Completed:** badge shows a checkmark SVG + `<p class="text-metadata text-fgCtrlOnImage">10</p>` (no "+"), plus a trailing `<div>Completed</div>` text node inside the card. Simplest robust DOM check: `/\bcompleted\b/i.test(card.textContent)` — but prefer the API `complete` flag (Section 3).
- **Locked:** no longer exists. Only today's daily set is rendered.

### 2.5 `/pointsbreakdown` is gone; the counter has no DOM home

Navigating to `https://rewards.bing.com/pointsbreakdown` redirects to `https://rewards.bing.com/dashboard?modal=membership`. The membership dialog contains only *static* copy ("Earn 5 points per Bing search, up to 25 a day") and level progress — **no live "X/Y" search counter anywhere in the new UI** (searched the full body text). The counter now lives only in the API.

### 2.6 PC search cap is level-based now

At Member level the cap is **25 points/day (5 searches × 5 points)** — not the old 150. Gold is higher. Do not hardcode caps; read `pointProgressMax` from the API (the existing farm loop already treats `max` dynamically, which is why it survives this). `PC_SEARCH_POINTS_PER_SEARCH = 5` in [src/util/config.ts](src/util/config.ts) is still correct.

### 2.7 Login detection

`isLoggedIn()` in rewards-content sniffs body text. Of its `DASHBOARD_SIGNALS`, "available points" still appears on the new home page; "explore on bing" does NOT (moved to /earn); others unverified. A better signal: the API returns the dashboard JSON only when authenticated (logged out → redirect/HTML/401). Use API success as the primary logged-in check, and text sniffing only to corroborate a *failed* fetch.

*As built:* `looksLoggedOut()` is consulted only after a fetch has already failed, so a successful fetch vetoes it. The `DASHBOARD_SIGNALS` half was dropped — every caller only ever tested for the logged-*out* answer, so the signals that returned "logged in" decided nothing.

---

## 3. Verified findings — the JSON API (the gift)

`GET https://rewards.bing.com/api/getuserinfo?type=1` — same-origin, cookie-authed, returns `{"dashboard": {...}}`. Verified live. Content-type is `text/plain` but the body is JSON — use `r.json()` or `JSON.parse`.

**Call it from the rewards.bing.com content script with a relative URL** (`fetch('/api/getuserinfo?type=1', {credentials:'include'})`) so cookies and origin are automatic. (A background fetch may also work given host permissions, but the content-script route is the one verified.)

### 3.1 Shape (fields we need)

```jsonc
{
  "dashboard": {
    "userStatus": {
      "counters": {
        "pcSearch": [
          {
            "name": "WW_NewLevel1_search_PC",
            "offerId": "WW_search_global_NewLevel1",
            "complete": false,
            "pointProgress": 20,        // ← live points earned today
            "pointProgressMax": 25,     // ← daily cap (level-dependent!)
            "attributes": { "type": "search", "title": "Search", "max": "25", "progress": "20", ... }
          }
          // may contain a second entry (e.g. bonus/mobile) — filter by attributes.type === "search" / name containing "PC"
        ]
        // other counter arrays exist (activityAndQuiz, dailyPoint, ...) — explore if needed
      },
      "levelInfo": { "activeLevel": "newLevel1", "progress": 334, "progressMax": 750, ... }
    },
    "dailySetPromotions": {
      // ⚠️ keyed by date "MM/DD/YYYY"; contains BOTH today and tomorrow — must select today's key
      "07/15/2026": [
        {
          "name": "Gamification_DailySet_20260715_Child1",
          "promotionType": "urlreward",
          "complete": false,
          "pointProgressMax": 10,
          "destinationUrl": "https://www.bing.com/search?q=Events+near+me&form=ML2X97&...",
          "attributes": { "title": "Upcoming events near me", "description": "...", "destination": "...", ... }
        },
        { "name": "..._Child2", "title": "Know your celebrity news?", ... },  // quiz — checkuser URL
        { "name": "..._Child3", "title": "Daily poll", ... }
      ],
      "07/16/2026": [ ...tomorrow, ignore... ]
    },
    "morePromotions": [
      // 30 items observed. Includes all 8 explore-on-bing offers.
      {
        "name": "ENUS_airportparking_exploreonbing_activation_Evergreen",  // ← "exploreonbing" in name
        "promotionType": "urlreward",
        "complete": true,
        "pointProgressMax": 10,
        "attributes": { "title": "Park with ease​", "description": "Search on Bing to ...", "destination": "https://www.bing.com/?form=ML2PCR&...&rwAutoFlyout=exb", ... }
      },
      // ...plus banners/campaigns with pointProgressMax: 0 (skip), quizzes, etc.
    ],
    "punchCards": [...], "promotionalItems": [...],  // exist; out of scope v1
  }
}
```

### 3.2 Mapping API → existing Activity model

| Extension concept | API source |
|---|---|
| Daily set activities (`CARD_SOURCE.DAILY_SET`) | `dashboard.dailySetPromotions[<today MM/DD/YYYY>]` |
| Explore on Bing (`CARD_SOURCE.EXPLORE`) | `dashboard.morePromotions[]` where `name` contains `exploreonbing` (case-insensitive) |
| More activities (`CARD_SOURCE.MORE_ACTIVITIES`) | remaining `morePromotions[]`; skip `pointProgressMax === 0`; keep existing ignore-string filtering from [src/util/activity.ts](src/util/activity.ts) |
| `title` / `description` | `attributes.title` / `attributes.description` |
| `points` | `pointProgressMax` |
| `cardState` Completed vs Actionable | `complete` boolean (locked no longer exists) |
| Search counters | `userStatus.counters.pcSearch` → `pointProgress`/`pointProgressMax` |
| Click join key to DOM | `destinationUrl` (equals card `<a href>`) |
| Logged-in check | API responds with parseable dashboard JSON |

Titles may contain zero-width chars (observed `"Park with ease​"` with a trailing U+200B) — strip/normalize before display and matching.

---

## 4. Recommended architecture

**API-first, DOM-click-second:**

1. **Extraction** (`ActivityExtractionOrchestrator` + rewards content script): fetch the API from the content script, build `Activity[]` from JSON per the table above. No DOM card scraping, no scroll-and-poll, no dependence on which tiles the page has rendered, immune to future re-skins. Keep `enrichSearchQueries` / `enrichUserActions` as-is (they operate on title/description text and still work — quiz/poll keyword detection verified against live titles "Daily poll", "…quiz").
2. **Clicking**: given an activity, locate the `<a>` in the current page whose `href` matches the activity's `destinationUrl` (match on URL prefix or the `name`/offer-id query param — hrefs can differ in encoding, so compare decoded, or match on the unique promo `name` embedded in `filters=...BTROID...`/`BTDSUOID` params, or fall back to normalized-href equality). **Fallback:** if the anchor isn't found (unexpanded "Show more" page, layout drift), open `destinationUrl` directly in a new tab — the URL carries the offer id and still credits points.

   *As built, two corrections:* the primary key is the **title**, not the URL — every explore tile shares one `destinationUrl` (§2.3), so the URL cannot tell them apart. And the synthetic `simulateClick` was replaced entirely: tiles credit only on a **trusted** event, which a content script cannot forge, so the background dispatches a real click over CDP (`LOCATE_CARD` → `trustedClick`). The direct-navigation fallback was not built.
3. **Page routing:** daily sets are clicked with the rewards tab on `/`; explore-on-bing and more-activities require navigating the rewards tab to `/earn` first. Add this navigation step at the start of `CompleteExploreOnBing` (and reuse for `CompleteMoreActivities`); navigate back to `/` afterwards if anything still needs the home page.
4. **Validation** (`validate-activity` step): re-fetch the API and check the promo's `complete` flag by `name`. Replaces DOM badge inspection; works from any page.
5. **Counters** (`fetch-counters` step + `FarmPcSearches`): read `userStatus.counters.pcSearch` from the API via the rewards tab. **Delete the dedicated breakdown tab entirely** — `FarmPcSearches.run` currently opens `REWARDS_BREAKDOWN_URL` ([src/orchestrators/farm-pc-searches.ts](src/orchestrators/farm-pc-searches.ts)); instead reuse the already-open rewards tab. Keep the poll-between-searches loop and `MAX_NO_PROGRESS` logic unchanged.

The `Activity` type needs one new field: `destinationUrl: string` (and probably `promoName: string` for validation-by-name). `dataBiId` is dead — it has since been deleted.

---

## 5. A/B support — removed

*This section described the dual-layout seam: layout detection, where the branch points went, and a removal checklist. The rollout completed and the seam was deleted — `RewardsLayout`, `detectLayout()`, `usesRedesignFlow()`, `src/content/legacy/`, the synthetic `CLICK_CARD` path, and the `/` vs `/earn` ternaries are all gone. Extraction is unconditionally API-driven, and every click is a trusted CDP click. See the **Reading the rewards site** section of DEVELOP.md for what remains.*

One decision from it is still worth knowing, because it is why the rewrite survived: **the API path was always layout-independent.** `/api/getuserinfo?type=1` predates the redesign and served both layouts, which is why extraction, validation, and counters needed no seam at all — only clicking and page routing ever branched.

---

## 6. Concrete change list by file

*Historical — this was the plan, and it has been executed. Where the build diverged from it, the "as built" notes in §4 and the fix lists in §9–§10 are authoritative; DEVELOP.md describes the result. Kept for the reasoning behind each change, not as a to-do list.*

| File | Change |
|---|---|
| [src/util/config.ts](src/util/config.ts) | Remove `REWARDS_BREAKDOWN_URL`. Add `REWARDS_EARN_URL = 'https://rewards.bing.com/earn'` and `REWARDS_API_PATH = '/api/getuserinfo?type=1'`. |
| [src/content/rewards-content.ts](src/content/rewards-content.ts) | Biggest rewrite. Replace DOM extraction with API fetch (`START_EXTRACT` handler returns activities built from JSON); resolve card elements by title, then promo name / `destinationUrl`; rewrite `GET_COUNTERS` to read the API; rewrite `VALIDATE_ACTIVITY` to check API `complete` by promo name; update `isLoggedIn`. |
| [src/util/activity-types.ts](src/util/activity-types.ts) | Add `destinationUrl`, `promoName` to `RawCard`/`Activity`. |
| [src/util/activity.ts](src/util/activity.ts) | `classifyCard`: primary classification by promo source/name (`exploreonbing` in name); keep text-regex as fallback; keep ignore lists, also skip `points === 0` more-promos. |
| [src/orchestrators/activity-extraction.ts](src/orchestrators/activity-extraction.ts) | Mostly intact (it's already message-driven). `onTabUpdated`'s `tab.url.startsWith(REWARDS_URL)` check already tolerates `/earn`. |
| [src/orchestrators/complete-explore-on-bing.ts](src/orchestrators/complete-explore-on-bing.ts) | Navigate the rewards tab to `/earn` before the loop; wait for content-script re-ready (reuse the extraction wait pattern or a lighter `PING`). |
| [src/orchestrators/complete-more-activities.ts](src/orchestrators/complete-more-activities.ts) | Same navigation concern (`/earn`). |
| [src/orchestrators/complete-daily-sets.ts](src/orchestrators/complete-daily-sets.ts) | ✅ Done. Ensures the rewards tab is on `/`, and the chain was reordered to daily → explore → more so it already is — one navigation per run instead of three. `PHASES` in `util/phase.ts` was reordered to match (it drives the popup's bar order). |
| [src/orchestrators/farm-pc-searches.ts](src/orchestrators/farm-pc-searches.ts) | Don't open a breakdown tab; pass the rewards tab id to `fetchCounters`. |
| [src/steps/fetch-counters.ts](src/steps/fetch-counters.ts) | Unchanged flow, but `GET_COUNTERS` now returns API-derived `{type:'pc search', current, max}` (content script maps `pointProgress/pointProgressMax`; keep the points→search-count division by `PC_SEARCH_POINTS_PER_SEARCH`). Make sure the returned `type` string still matches `PC_SEARCH_TYPE`. |
| [src/steps/validate-activity.ts](src/steps/validate-activity.ts) | Message payload gains `promoName`; content script answers from a fresh API fetch. |
| [src/util/tab-manager.ts](src/util/tab-manager.ts) | ✅ Answered: card clicks open a new tab, so `clickCardAndCaptureTab`'s capture model stands. It also grew the trusted CDP click path, which the original plan did not anticipate. |
| README.md / DEVELOP.md | Document two-page flow, API-based extraction, level-based caps. Follow the Version Release Checklist in DEVELOP.md. |

Untouched: `search-content.ts` (bing.com search box unaffected), warm-up, timing, messaging constants (add new fields, not new actions, where possible), popup UI (phase bars unchanged unless phases are reordered).

---

## 7. Open questions / verify during implementation

1. ✅ **New-tab vs same-tab on card click** (2.3). **Answered: clicks open a new tab**, so the capture model stands.
2. **Quiz/poll overlay flow:** daily-set quiz/poll destinations now go through `bing.com/rewards/checkuser?...` redirects. Confirm the "wait for user action" linger flow still works (tab opens on bing.com — `search-content.ts` will be injected there; ensure it doesn't interfere and `PERFORM_SEARCH` is not sent to quiz tabs — current code already doesn't).
3. **Second `pcSearch` array entry:** counters.pcSearch is an array; observed one entry. Confirm filtering picks the right one if there are two (e.g. bonus multiplier entries).
4. **Date key for `dailySetPromotions`:** `"07/15/2026"` — confirm it matches the user's local date (build the key from local time, not UTC).
5. **API stability of `complete` timing:** confirm `complete` flips promptly after an activity (the old DOM sometimes lagged; existing retry logic in orchestrators covers this — keep it).
6. ✅ **Legacy layout still reachable?** Moot — the rollout completed and legacy support has been removed.
7. **`rwAutoFlyout=exb` flyout on Bing home:** the explore click lands on bing.com with a rewards flyout open. Confirm it doesn't block `PERFORM_SEARCH`'s search-box fill (selector may need a dismiss step).

---

## 8. Suggested implementation order

*Historical — steps 1–5 landed in commits `a14e2dd` and `d2bb6e4`; step 5 has since been deleted along with the rest of legacy support.*

1. **Data layer:** API fetch + JSON→`Activity[]` mapping in `rewards-content.ts`, behind the existing `START_EXTRACT`/`ACTIVITIES_FOUND` messages. (Testable alone: run extraction, check debug panel counts — expect 3 daily + 8 explore.)
2. **Counters:** `GET_COUNTERS` from API; farm phase drops the breakdown tab.
3. **Click targeting + page routing:** card matching, `/earn` navigation, phase reorder decision, new-tab verification (open question 1).
4. **Validation:** API `complete` checks.
5. ~~**Legacy adapter:** wrap old click/extraction behavior per Section 5.~~ Built, then removed with the rollout.
6. **Docs + release** per DEVELOP.md checklist.

Each step keeps the extension shippable; steps 1–2 alone fix "extension finds nothing and farm never starts" for redesigned users.

---

## 9. Post-implementation review findings (2026-07-16)

Steps 1–5 are implemented and type-check clean, but **nothing here has been exercised against the live site**. A code review of steps 4–5 found the following.

**Status: 9.1, 9.2, and 9.3 are fixed; 9.4 is open.** A second review pass (2026-07-16) found further defects — see §10.

> **Read §9 and §10 as a dated record, not as a map of the current code.** They are kept for the reasoning — each entry explains a failure mode worth not reintroducing — but they were written while legacy support still existed, and they name code that has since been deleted (`usesRedesignFlow`, `detectLayout`, `identify()`, `legacyExtractLoop`, `extractedEls`, `REWARDS_API_FALLBACK_WAIT`, the line numbers). Two entries were made moot outright by the removal: **9.1** (the `Unknown`-routed-as-legacy bug — there is no legacy arm to route to, and no layout to be unknown about) and **9.4** (the dead legacy counter fallback, deleted). The rest still describe live behavior. §10's **Open** list is the one part that is still a to-do.

### 9.1 FIXED — `Unknown` layout is routed as **legacy**, breaking the run for the users the fallback exists to serve

*Fixed by `usesRedesignFlow(layout)` (`util/activity-types.ts`), which routes `Unknown` with the redesign; the orchestrators call it instead of comparing to `REWARDS_LAYOUT.Redesign`.*

`rewards-content.ts` reports `layout: 'unknown'` when DOM detection times out but the API still returns cards ([`:115`](src/content/rewards-content.ts#L115)) — by construction that is *the API path*, i.e. almost certainly a redesign user. But every orchestrator branches on `isRedesign = layout === REWARDS_LAYOUT.Redesign`, so `Unknown` gets the full legacy treatment: routed to `/` instead of `/earn`, no `EXPAND_SECTION`, and `trusted=false`.

Consequence: explore + more-activities tiles aren't on the page at all and every click fails; daily-set tiles are found but clicked *untrusted*, so they open without ever crediting. Net result is zero activity points with only one INFO log line as a signal.

Fix direction: treat `Unknown` as redesign (it is the API path), or carry a separate "how did we extract" flag distinct from "which DOM layout did we see".

### 9.2 FIXED — A logged-out redesign user is reported as **logged in**, and the fallback gets a single API attempt

*Fixed by `fetchDashboardResult()`'s explicit `logged-out` status, `detectLoginState()`, the `REWARDS_API_FALLBACK_WAIT` window for the `Unknown` branch, and reporting `loggedIn: false` when the deadline passes with the dashboard unread. Note the identified-`Redesign` branch still inherits the exhausted deadline — see §10.*

Two compounding issues in `redesignExtractLoop` ([`:123-139`](src/content/rewards-content.ts#L123-L139)):

- **`fetchDashboard()` returning `null` is never treated as logged-out.** §2.7 prescribes using API success as the *primary* logged-in check; the code instead only concludes logged-out from the legacy body-text sniff, whose `LOGOUT_SIGNALS` were never verified against the new site's copy. When the sniff is inconclusive, the loop times out and sends `sendActivities([], true, layout)` — `loggedIn: true` with zero cards.
- **The `Unknown` fallback inherits an exhausted `start`.** `:115` passes the 15-second-old `start` into a loop guarded by `Date.now() - start < MAX_WAIT_MS`, which is already false — so the "last resort" makes exactly one attempt and never retries a transient failure.

Consequence: a signed-out user gets no sign-in prompt, all phases no-op, and the run ends `RUN_END.SUCCESS` → **"Done for today!"**. This is the worst failure mode in the list because it reports success.

### 9.3 FIXED — `findCardByDestination` prefers the ambiguous key, so a title miss clicks the **wrong** explore tile

*Fixed: the blocks are swapped (`promoName` first, `destinationUrl` last resort), and card lookup is now scoped to the activity's own section via `cardAnchors()` / `sectionIdForActivityType()`, so a title miss can no longer reach another section's tiles at all.*

[`:201-224`](src/content/rewards-content.ts#L201-L224) tries `destinationUrl` before `promoName`. But all explore tiles share one `destinationUrl` (§2.3, §3.1) — the code says so itself at `:171-173`. So for explore tiles the first branch always matches and always returns the *first* explore anchor in document order, making the discriminating `promoName` branch unreachable.

Consequence: when `findCardByTitle` misses (zero-width/em-dash drift, decorative `img[alt]`), E5's search query runs in the tab E1 opened, E5 validates false, retries, clicks E1 again. E5 fails permanently while the log claims it was attempted.

Fix direction: swap the blocks — `promoName` first, `destinationUrl` as last resort.

### 9.4 LOW — The legacy counter fallback can never fire

`GET_COUNTERS` falls back to `extractLegacySearchCounters()` ([`:380`](src/content/rewards-content.ts#L380)), which scrapes `.pointsBreakdownCard` — markup that only exists on `/pointsbreakdown`. That page is gone and `farm-pc-searches` now messages the rewards tab on `/` or `/earn`, so the fallback always returns `[]`. Harmless (fetch-counters polls, fails, farm is skipped with a logged failure) but it presents a safety net that doesn't exist.

### Checked and dismissed (do not re-litigate)

- **`promoComplete` flattening `dailySetPromotions` across dates** — no collision; daily-set names are date-stamped (`..._20260715_Child1`) and the lookup is exact.
- **`extractedEls` going stale on the redesign path** — not reachable. `detectLayout` checks redesign anchors first, the map is only written by `legacyExtractLoop`, and `ensureRewardsPage` navigates (fresh content script) anyway.
- **`null` vs `false` from `promoComplete`** — correctly guarded on `complete !== null`; and `Error` vs `Incomplete` are behaviorally identical downstream regardless.
- **`CardState.Locked` double-counting in `sumCompleted`** — `complete` is checked before `is_unlocked`, orchestrators filter on `Actionable`, and `sumCompleted` counts only `Completed`. Sets are disjoint.

### Still unverified against the live site

§7's open questions remain largely untested — except Q1 (new-tab vs same-tab), now **answered: clicks open a new tab**, so the capture model stands. The trusted-click (CDP) path itself has still never been observed working, and Q5 (does `complete` flip promptly?) directly governs whether validation retries are sufficient.

---

## 10. Second review pass (2026-07-16)

A full review of both commits plus the working tree.

**Two review findings were retracted on live-site evidence, both from bad research in this document — treat §2's unverified claims with suspicion until checked:**

- The "explore is a carousel" claim in §2.2 was wrong. Explore is not paginated; `moreactivities` is the only paginated section. Docs corrected.
- "No recovery if a card click navigates in place" rested on §7 Q1 being open. Q1 is now answered — **clicks open a new tab** — so the capture model is correct and there is nothing to guard against.

### Fixed in this pass

- **Extraction timeout budget was overcommitted.** The orchestrator's 20s `FETCH_ACTIVITIES` clock started at tab creation while the content script's 15s + 4s budget starts at page load, so any tab load over ~1s could settle an empty result before the reply landed — and the timeout path reported `loggedIn: true`, rendering it as "Done for today!". The timer is now armed on `START_EXTRACT`, and the timeout reports `loggedIn: false`.
- **§9.3** — see above.
- **Card lookup was document-wide** — now scoped per section (`cardAnchors`), which also defuses the `startsWith` tier reaching `section#quests` / `section#levelup`.
- **`farm-pc-searches` had no tab guard** — it now verifies the rewards tab and re-opens it if the user closed it, instead of burning 20 polls and silently skipping the whole cap.
- **A signed-in user could be reported logged out, two ways.** `hasSignInControl()` matched any `p/a/button/span` reading exactly "Sign in" — including `display:none` and pre-hydration nodes — and concluded logged-out with no API attempt; it now requires the control to be *visible*, and `identify()` routes a DOM logged-out reading through the API path so a successful `fetchDashboard()` vetoes the sniff. Separately, the identified-`Redesign` branch inherited the exhausted `start + MAX_WAIT_MS` deadline (the §9.2 fix had landed only on the `Unknown` branch), so a late SPA render plus one transient API error was final; the deadline is now floored at a fresh `REWARDS_API_FALLBACK_WAIT` window.
- **`ensureRewardsPage` compared pathnames without origin** — `/` matches `/` on every host, so a tab that drifted off rewards.bing.com was treated as already there. Now compares origin + pathname (`safePageKey`).

Also fixed, in a follow-up pass:

- **§9.4** — the dead counter fallback is deleted, along with `extractLegacySearchCounters()` and the three counter selectors. The API is now the only counter source for both layouts, which is what it already was in practice; there was never a fallback to build, since `/pointsbreakdown` is gone.
- **`trustedClick`'s delays** now use `rawRandMs` + the same `TIMING.CLICK_SIMULATION_*` presets as the legacy synthetic click (plus a new `CLICK_SIMULATION_SETTLE_DELAY`), so the two paths can't drift and the pacing gets the long-tail distribution instead of uniform. The local `rand()` remains for click *geometry* only.
- **Phase order** is now daily → explore → more (§6), with `PHASES` reordered to match.
- **`classifyCard()`** switches on `card.source` alone. `RawCard` never carried `attributes.offerid`, so re-deriving explore from `promoName` silently dropped promos the mapper's `isExplorePromo()` had matched by offer id. `EXPLORE_ON_BING_RE` and `dataBiId` are gone (checklist step 6, done early). Legacy's catch-all EXPLORE is now trusted as explore — accepted deliberately, legacy is on its way out.

### Open

1. **LOW — a tab opening after the 10s `TAB_CAPTURE` window is never adopted**: the retry re-clicks, the late tab leaks untracked (its opener is the untracked rewards tab), and the tile double-fires. Rare — `onCreated` fires at tab creation, so a >10s delay generally means the click never registered, which is exactly the case the retry exists for and handles correctly. The more real cost is that every attempt burns the full 10s, so a popup-blocked user waits ~35s for the prompt.
2. **LOW (efficiency)** — `EXPAND_SECTION` sleeps a fixed 1.5s after each click where polling `tileCount()` would do. Only `moreactivities` paginates, so this is ~7.5s per run (worst case ~18s), and the loop always wastes a final 1.5s discovering the last click revealed nothing.

### The remaining risk is not in this list

Everything above is small. The real exposure is that **the redesign path has still never run against the live site** — in particular the trusted-click (CDP) flow and Q5 (does `complete` flip promptly enough for validation to see it?). One real run will teach more than another review pass.
