# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build              # Full build: extension + marketing site
npm run extension:build    # Extension only (lint, type-check, esbuild, assets)
npm run extension:watch    # Dev mode: watch tsc + watch esbuild in parallel
npm run extension:content  # Re-bundle content scripts only (esbuild → dist/content/)
npm run website:build      # Build the marketing site (site/ → docs/) via Eleventy
npm run website:watch      # Eleventy dev server at localhost:8080 with live reload
npm run website:preview    # website:watch + auto-open browser
npm run extension:lint     # Run ESLint + Prettier check on src/
npm run extension:lint:fix # Auto-fix ESLint issues + reformat with Prettier
```

After building, load the `dist/` folder as an unpacked Chrome extension.

## Architecture

This is a **Chrome Extension (Manifest V3)** that automates Bing Rewards daily points. The execution flow is:

```
Popup (Start button)
  → background.ts (service worker, message router)
    → start-run (StartRun class, owns TabManager)
      → activity-extraction (opens rewards tab, confirms login via DOM probe, parses activity cards from the DOM)
      → warm-up-searches (optional warm-up phase)
      → complete-daily-sets (on /, opens daily set tiles; waits for user on quizzes/polls)
      → complete-explore-on-bing (navigates to /earn, clicks "Search on Bing" cards, runs search queries)
      → complete-more-activities (still on /earn; opens "Keep earning" tiles, dwells, validates)
      → farm-pc-searches (runs searches until the PC counter cap is reached)
```

Content scripts are bundled by esbuild as IIFEs, so they **can** use `import`/`export` at source level (esbuild inlines the modules) — `rewards-content.ts` imports from `../util/`. What MV3 forbids is loading the *emitted* script as an ES module. Do not add content scripts to `tsconfig.build.json`.

### Reading the rewards site

rewards.bing.com was rewritten in 2026 (React + react-aria + Tailwind). The dashboard JSON API (`/api/getuserinfo?type=1`) was the source of truth for a while after that, until it started returning 401 even for live sessions — so now **everything reads the DOM**, via `src/content/rewards-dom.ts`:

- **Anchors**: semantic section ids (`section#dailyset` on `/`; `section#exploreonbing`, `section#moreactivities` on `/earn`) are the only durable hooks — react-aria ids are random per render. Tailwind design-token classes (`text-globalBody2Strong`, `bg-statusSuccessRewardsBg`, …) are semi-stable and every read has a structural fallback.
- **Cards** are `a[href]` tiles: title in `img[alt]`/the strong `<p>`; actionable = `+N` badge; completed = success pill + trailing "Completed" label. Explore tiles read "Activated" (armed, uncredited) between click and credit — that is NOT complete. Badge-less tiles are 0-point promos and are skipped. The join key is **cleaned title within section**, tie-broken by the anchor's resolved href (captured at extraction, so exact).
- **Login detection** is the `REWARDS_STATUS` probe: a visible "Sign in" control convicts; a fully-loaded page showing none, confirmed across several probes (SPA hydration), reads as signed in.
- **Counters** come from the "Points breakdown" flyout on `/earn` (opened via the "Today's points" toggle) — the site renders no inline counter anywhere else.
- **Clicks stay trusted.** Tiles only credit on a *trusted* click, so the background dispatches a real one over the Chrome DevTools Protocol (`debugger` permission) rather than synthesizing pointer events; the flyout toggle rides the same path so nothing the extension dispatches is synthetic (`isTrusted: false` is page-detectable).

### Key Layers

**Managers** (`src/managers/`) — Top-level run lifecycle controllers. `start-run.ts` (`StartRun` class) owns a `TabManager`, opens the rewards tab, then fires the orchestrator chain as fire-and-forget; `stop-run.ts` cancels an active run and closes all opened tabs.

**Orchestrators** (`src/orchestrators/`) — Phase executors called by managers. `OrchestratorBase` (`src/interfaces/orchestrator.ts`) provides the base class, including `ensureSectionReady()` — the phase preamble that hops the rewards tab between `/` and `/earn` (each `SECTION` entry carries its host `url`) and then expands the section. `TabManager` (`src/util/tab-manager.ts`) handles all tab operations including `clickCardAndCaptureTab`, `expandSection`, and the trusted CDP click.

**Steps** (`src/steps/`) — Reusable async routines called by orchestrators: `fetch-counters`, `perform-search`, `linger-on-tab`, `validate-activity`, `wait-for-user-action`.

**Shared helpers** — `run-activity-loop.ts` (per-activity iteration, progress, points) and `execute-with-retry.ts` (attempt/linger/retry + failure recording) are used by all three activity orchestrators; prefer them over hand-rolling a loop.

**Content Scripts** (`src/content/`) — Injected into Bing pages. Bundled as IIFEs by esbuild and excluded from `tsconfig.build.json`.
- `rewards-content.ts` — Runs on `rewards.bing.com`; message router handling `REWARDS_STATUS`, `EXTRACT_SECTIONS`, `LOCATE_CARD`, `LOCATE_CONTROL`, `VALIDATE_ACTIVITY`, `READ_COUNTERS`. DOM parsing itself lives in `rewards-dom.ts` (inlined by esbuild).
- `search-content.ts` — Runs on `www.bing.com`; handles `PERFORM_SEARCH` message, fills and submits the search box.

**State** — Split into two files:
- `src/util/persistent-state.ts` — `chrome.storage.local` backed; survives service worker restarts. `RunState` (progress, warm-up queries, counters, `activityState`, failures, debug log) is wiped by `resetRunState()` at every run start — there is no run-date gate and no mid-run resumption. `UserPreferences` (`skipWarmUp`, `timingMultiplier`, `debugMode`, …) persists across runs. All writes serialized through `enqueueWrite()`.
- `src/util/runtime-state.ts` — In-memory only (`activeOrchestrator`) — resets on SW restart.
- Phase progress and points tracked in `header.phases` / `header.phasePoints` using `PHASE` constants (`warmup`, `explore`, `daily`, `farm`) and read by the popup for per-phase progress bars.
- `lastRunSummary` stores the most recent `RunSummary` (start/end times, per-phase points, activity counts, end reason) so the popup can render the end-of-run summary card after a run finishes.

**Timing** (`src/util/timing.ts`) — All delays use `randMs(min, max)` with triangular distribution. `TIMING.LINGER_ON_PAGE` (5–7s) is the standard dwell preset used between actions.

### Build System Details

- `tsconfig.json` — IDE/type-check config; includes all `src/**/*` including content scripts.
- `tsconfig.build.json` — Emit config; excludes content scripts (they're handled by esbuild separately to avoid conflicts).
- Full `npm run build` first runs `tsc --noEmit` (type-checks everything), then emits non-content files, bundles content scripts with esbuild, and finally builds the marketing site with Eleventy (`site/` → `docs/`).

### Marketing site (`site/` → `docs/`)

- Eleventy (`eleventy.config.js`) reads from `site/` and writes to `docs/`. `docs/` is pure generated output, gitignored, and built/deployed by the `Deploy Site` GitHub Actions workflow (`.github/workflows/pages.yml`).
- Layouts and partials live in `site/_includes/` (`base.njk`, `post.njk`, `partials/nav.njk`, `partials/footer.njk`) — nav, footer, and meta tags exist in exactly one place each.
- Global template data (base URL, version, download URL) is in `site/_data/site.js`, which reads `package.json` so the download button stays in sync with the extension version automatically.
- Hand-written pages: `site/index.njk`, `site/contact.njk`. Blog listing: `site/blog.njk`. Blog posts: markdown in `site/blog/*.md` + directory data `site/blog/blog.json`. Sitemap: `site/sitemap.njk`. Static assets: `site/static/*` (passthrough-copied).
- Do not hand-edit files under `docs/` — they are overwritten on every `npm run website:build` and `npm run build`.

## Documentation

When updating README.md or DEVELOP.md, read the actual source code to verify every claim before writing. Do not infer behavior from file names or outdated docs.

## Version Releases

Follow the **Version Release Checklist** in `DEVELOP.md` exactly and in order. The most commonly skipped step is updating DEVELOP.md and README.md — these must reflect actual source code behavior, not just commit message summaries. Read the diffs.

## Refactoring

When refactoring or moving files, always grep for all import paths referencing the moved file and update them. Then run the build/watch command to verify nothing is broken.

## General Rules

Before suggesting new infrastructure (new watchers, new files, new patterns), check if there's an existing mechanism that already handles it. Ask the user if unsure.

## Debugging

CSS selectors in this project must be verified against actual DOM structure. When debugging selector issues, add logging to confirm what elements are found before assuming the logic is wrong.

### Message Passing

Most cross-context communication uses `chrome.runtime.sendMessage`. Constants live in `src/util/messaging.ts` (`MSG_ACTION`), and `AppMessage` is a discriminated union — add new fields/actions there so payloads stay typed. Key flows:
- Popup ↔ Background: `START`, `STOP`, `GET_RUN_STATE`, `GET_PREFERENCES`, `SET_PREFERENCE`, `PING`, `PURGE`, `USER_ACTION_COMPLETE`, `RESET_STALE`
- Background ↔ Rewards content: `REWARDS_STATUS`, `EXTRACT_SECTIONS`, `LOCATE_CARD`, `LOCATE_CONTROL`, `VALIDATE_ACTIVITY`, `READ_COUNTERS`
- Background → Search content: `PERFORM_SEARCH`, `SCROLL_PAGE`, `CLICK_RESULT`
- Background → Popup (push): `PROGRESS`, `DEBUG_ENTRY`, `FAILURE_ENTRY`

The exception: the trusted card click is dispatched by the background directly into the page over the Chrome DevTools Protocol, not via a message. The content script only reports where to aim (`LOCATE_CARD`).
