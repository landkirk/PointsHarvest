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

This is a Chrome/browser extension project. Content scripts cannot use ES module imports (no `import`/`export` statements). Use message passing or shared globals for content scripts.

This is a **Chrome Extension (Manifest V3)** that automates Bing Rewards daily points. The execution flow is:

```
Popup (Start button)
  → background.ts (service worker, message router)
    → start-run (StartRun class, owns TabManager)
      → activity-extraction (opens rewards tab, classifies activity cards)
      → warm-up-searches (optional warm-up phase)
      → complete-explore-on-bing (clicks "Search on Bing" activity cards, runs search queries)
      → complete-daily-sets (opens daily set tiles; waits for user on quizzes/polls, auto-closes others)
      → farm-pc-searches (runs searches until PC counter cap is reached)
```

### Key Layers

**Managers** (`src/managers/`) — Top-level run lifecycle controllers. `start-run.ts` (`StartRun` class) owns a `TabManager`, opens the rewards tab, then fires the orchestrator chain as fire-and-forget; `stop-run.ts` cancels an active run and closes all opened tabs.

**Orchestrators** (`src/orchestrators/`) — Phase executors called by managers. `OrchestratorBase` (`src/interfaces/orchestrator.ts`) provides the base class. `TabManager` (`src/util/tab-manager.ts`) handles all tab operations including `clickCardAndCaptureTab`.

**Steps** (`src/steps/`) — Reusable async routines called by orchestrators: `fetch-counters`, `perform-search`, `linger-on-tab`, `validate-activity`.

**Content Scripts** (`src/content/`) — Injected into Bing pages. Cannot use ES modules (Chrome MV3 limitation), so they are bundled as IIFEs by esbuild and excluded from `tsconfig.build.json`.
- `rewards-content.ts` — Runs on `rewards.bing.com`; polls DOM for activity cards, handles `CLICK_CARD`, `VALIDATE_ACTIVITY`, `GET_COUNTERS` messages.
- `search-content.ts` — Runs on `www.bing.com`; handles `PERFORM_SEARCH` message, fills and submits the search box.

**State** — Split into two files:
- `src/util/persistent-state.ts` — `chrome.storage.local` backed; survives service worker restarts (run date, progress, search queue, debug logs, `skipWarmUp`). All writes serialized through `enqueueWrite()`.
- `src/util/runtime-state.ts` — In-memory only (`activeOrchestrator`) — resets on SW restart.
- Phase progress and points tracked in `header.phases` / `header.phasePoints` using `PHASE` constants (`warmup`, `explore`, `daily`, `farm`) and read by the popup for per-phase progress bars.
- `lastRunSummary` stores the most recent `RunSummary` (start/end times, per-phase points, activity counts, end reason) so the popup can render the end-of-run summary card after a run finishes.

**Timing** (`src/util/timing.ts`) — All delays use `randMs(min, max)` with triangular distribution. `TIMING.LINGER_ON_PAGE` (5–7s) is the standard dwell preset used between actions.

### Build System Details

- `tsconfig.json` — IDE/type-check config; includes all `src/**/*` including content scripts.
- `tsconfig.build.json` — Emit config; excludes content scripts (they're handled by esbuild separately to avoid conflicts).
- Full `npm run build` first runs `tsc --noEmit` (type-checks everything), then emits non-content files, bundles content scripts with esbuild, and finally builds the marketing site with Eleventy (`site/` → `docs/`).

### Marketing site (`site/` → `docs/`)

- Eleventy (`eleventy.config.js`) reads from `site/` and writes to `docs/`. `docs/` is pure generated output but is committed so GitHub Pages can serve it.
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

All cross-context communication uses `chrome.runtime.sendMessage`. Constants live in `src/util/messaging.ts` (`MSG_ACTION`). Key flows:
- Popup ↔ Background: `START`, `STOP`, `GET_STATE`, `PING`, `PURGE`, `USER_ACTION_COMPLETE`
- Background ↔ Rewards content: `START_EXTRACT`, `CLICK_CARD`, `VALIDATE_ACTIVITY`, `GET_COUNTERS`
- Background → Search content: `PERFORM_SEARCH`
- Background → Popup (push): `PROGRESS`, `COMPLETE`, `DEBUG_ENTRY`, `LINGER_WAITING`
