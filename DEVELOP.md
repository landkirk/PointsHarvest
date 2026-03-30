# Developer Guide

## Development Setup

1. Clone the repository
2. Run `npm install` to install dev dependencies (TypeScript, esbuild, concurrently, @types/chrome)
3. Run `npm run build` to do a full build, or `npm run watch` for incremental compilation during development
4. Open Chrome and navigate to `chrome://extensions`
5. Enable **Developer mode** (toggle in top right)
6. Click **Load unpacked** and select the project folder (point at the repo root, not `src/`)
7. Make your changes to files in `src/`
8. Rebuild with `npm run build` (or let `watch` pick up the change), then click the refresh icon on the extension card

## Build System

The project uses two tools for compilation:

- **tsc** — type-checks all source and emits `dist/` for everything except content scripts
- **esbuild** — bundles content scripts into self-contained files in `dist/content/`

Content scripts are bundled separately because Chrome injects them as classic scripts with no module loader. esbuild resolves all `import` statements at build time and emits a single IIFE per file, so they can freely import from `util/` and elsewhere without any runtime module system.

### Scripts

| Command | What it does |
|---|---|
| `npm run build` | Full type-check (`tsc --noEmit`) → emit non-content files (`tsc -p tsconfig.build.json`) → bundle content scripts (esbuild) → copy `popup.html` |
| `npm run watch` | `tsc -p tsconfig.build.json --watch` and `esbuild --watch` run in parallel via concurrently |
| `npm run build:content` | Re-bundle content scripts only (useful after changing `util/` imports) |
| `npm run watch:content` | Watch and re-bundle content scripts only |

The full `build` runs `tsc --noEmit` first so type errors in any file (including content scripts, which are excluded from tsc's emit) fail the build before anything is written to `dist/`.

During `watch`, the IDE handles content script type errors in real time; the watch pipeline handles fast re-emission on save.

### tsconfig files

- **`tsconfig.json`** — full config, used by the IDE and `tsc --noEmit`. Includes all `src/**/*`.
- **`tsconfig.build.json`** — extends `tsconfig.json` but excludes `src/content/`. Used for `tsc` emit only, so tsc and esbuild don't both write to `dist/content/` during watch.

## Project Structure

```
manifest.json           Extension config (Manifest V3) — references dist/ for compiled files
package.json            npm scripts and dev dependencies
tsconfig.json           TypeScript config (full — IDE + type check)
tsconfig.build.json     TypeScript config (emit only — excludes content scripts)
.eslintrc.json          ESLint config
.prettierrc             Prettier formatting config
src/                    Source files (edit these)
  background.ts         Service worker — tab event listeners, message routing
  managers/
    start-run.ts            Top-level run coordinator (fire-and-forget from background)
    stop-run.ts             Cancels active run, invokes pending resolvers, closes tabs
  orchestrators/
    complete-explore-on-bing.ts  Iterates mapped cards, clicks each, runs searches
    complete-daily-sets.ts       Opens each daily set tile; lingers for interactive ones
    farm-pc-searches.ts          Farms remaining PC search points after cards are done
    warm-up-searches.ts          Runs warm-up searches before the main Explore phase
  steps/
    fetch-activities.ts     Open rewards tab, wait for content script, return raw activities
    fetch-counters.ts       Poll breakdown tab for search point counters
    perform-search.ts       Dwell and execute a single search in a tab
    linger-on-tab.ts        Pause automation and wait for user to complete a tile
    validate-activity.ts    Confirm an activity is marked complete on the rewards page
  util/
    activity.ts         Activity/MappedActivity types, CardState enum, buildSearchList()
    config.ts           URL constants (REWARDS_URL, REWARDS_BREAKDOWN_URL)
    context.ts          createContext() — bundles setState/dbg/setHeaderMessage for orchestrators
    debug.ts            Logging helpers (dbg, resetLog) and debug type definitions
    failures.ts         Failure type and helpers
    messaging.ts        MSG_ACTION constants and MsgAction type
    screens.ts          SCREENS array and OnboardingScreen interface
    search-queries.ts   PC_SEARCH_QUERIES pool used by farm-pc-searches
    state.ts            chrome.storage.local persistent state + PHASE constants + write queue + runtime state
    tabs.ts             Tab utilities (openTab, waitForTabLoad, closeOwnedTabs)
    timing.ts           randMs, sleep, lingerOnPage, TIMING presets
    update-check.ts     Version comparison for update notifications
  interfaces/
    orchestrator.ts     OrchestratorBase abstract class
  ui/
    popup.html          Extension side panel UI
    popup.ts            Popup logic — phase progress rendering, real-time updates
    onboarding.html     First-run onboarding UI (ToS, Bing warning, changelog)
    onboarding.ts       Onboarding flow controller
    debug-panel.ts      renderDebug(), appendLogEntry(), renderActivitiesAndCounters()
    failure-banner.ts   renderFailures(), appendFailure()
    screens/            HTML fragments for onboarding screens (ToS, Bing warning, changelog)
  content/
    rewards-content.ts  Content script injected into rewards.bing.com (bundled by esbuild)
    search-content.ts   Content script injected into www.bing.com (bundled by esbuild)
dist/                   Compiled output (generated — do not edit)
.github/workflows/      GitHub Actions for automated releases
```

## Key Components

### background.ts
- Calls `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` on startup so clicking the extension icon opens the side panel
- Tab event listeners: load detection, tab capture, tab removal
- Message routing: `START` / `STOP` / `GET_STATE` / `PING` / `PURGE` / `USER_ACTION_COMPLETE`
- Delegates all run logic to `managers/start-run.ts` and `managers/stop-run.ts`

### managers/start-run.ts
- Loads state, resets session/log/storage, creates a context object
- Accepts a `skipWarmUp` flag (forwarded from the popup `START` message); when true, the `WarmUpSearches` orchestrator is skipped entirely and a log entry is written instead
- Fires `_executeRun` as fire-and-forget (returns immediately so background can ack the message)
- `_executeRun` chains the four sub-orchestrators (WarmUp → ExploreOnBing → DailySets → FarmPcSearches) via `_runOrchestrator`, which sets/clears `activeOrchestrator` in `state.ts` around each run
- On completion, sends a desktop notification using the extension icon

### managers/stop-run.ts
- Calls `setIsActivelyRunning(false)` and persists stopped status
- Invokes any pending resolver functions (unblocking awaiting code), then calls `resetSession()`
- Removes all tabs tracked in `openedTabIds`

### orchestrators/complete-explore-on-bing.ts
- Iterates the mapped activity list from a given `startIndex`
- Sends `clickCard` to content script, captures the new tab, waits for load
- Calls `steps/perform-search`, validates the activity, sends progress updates to popup

### orchestrators/complete-daily-sets.ts
- Iterates daily set activities extracted from the rewards page
- Uses `clickCardAndCaptureTab` (with `MSG_TARGET.DAILY_SET`) to click the card element on the rewards page — this is how Bing registers the activity as started, matching the same flow used for Explore cards
- If the activity title matches `quiz|poll|test|puzzle`, calls `steps/linger-on-tab` to pause for user interaction; otherwise dwells and closes
- Calls `steps/validate-activity` after each activity

### orchestrators/farm-pc-searches.ts
- Opens a breakdown tab if one isn't already open, then polls for the PC Search counter
- Runs Bing searches in a loop until the cap is reached or no progress after `MAX_NO_PROGRESS` (3) consecutive searches
- Surfaces a failure and breaks on no-progress, allowing the run to continue to the next orchestrator

### steps/fetch-activities.ts
- Opens rewards.bing.com in a background tab
- Waits up to 20s for content script to report extracted activities and daily sets
- Returns raw activities; query mapping is done by `buildSearchList()` in `util/activity.ts`

### steps/fetch-counters.ts
- Sends `GET_COUNTERS` to the breakdown tab and polls up to 20 times (1s interval)
- Returns `SearchCounter[]` — each counter is typed `{ type, current, max }`

### steps/validate-activity.ts
- Sends `VALIDATE_ACTIVITY` to the rewards tab content script after completing an activity
- Logs whether the activity is marked completed, not found, or still pending

### steps/linger-on-tab.ts
- Activates the given tab so the user can complete a quiz/poll/etc.
- Resolves when the user clicks **Done** in the popup (`USER_ACTION_COMPLETE` message) or closes the tab directly

### steps/perform-search.ts
- Pre-search `lingerOnPage()` dwell, sends `PERFORM_SEARCH` to search-content.ts, post-search `lingerOnPage()` dwell

### util/context.ts
- `createContext()` returns `{ setState, dbg, setHeaderMessage }` — a lightweight bundle passed through all orchestrators and steps so they don't import globals directly
- The `dbg` wrapper automatically tags each log entry with the currently active orchestrator's name (read from `state.ts` at call time)

### util/state.ts
- `setState` / `loadState` / `resetState` — write-through cache backed by `chrome.storage.local`; all writes go through `enqueueWrite()` to serialize concurrent storage operations and prevent race conditions
- `setHeaderState` / `getHeaderState` — deep-merge writes to the `header` subobject (`headerMessage`, `activePhase`, `phases`, `phasePoints`)
- `setDebugState` / `getDebugLog` / `getFailures` — accessors for debug and failure sub-state
- `PHASE` constants (`explore`, `daily`, `farm`) and `PhaseProgress` / `PhaseProgressMap` / `PhasePointsMap` types used by the popup to render per-phase progress bars and point totals
- `isActivelyRunning` / `activeOrchestrator` — runtime-only flags (not persisted); reset on service worker restart
  - `getIsActivelyRunning` / `setIsActivelyRunning` — guards the run loop
  - `getActiveOrchestrator` / `setActiveOrchestrator` — tracks which orchestrator is currently executing; used by `context.ts` to label log entries

### util/config.ts
- URL constants (`REWARDS_URL`, `REWARDS_BREAKDOWN_URL`) shared across modules

### util/search-queries.ts
- `PC_SEARCH_QUERIES` — pool of queries used by `farm-pc-searches.ts`

### util/debug.ts
- `dbg(type, message, orchestrator?)` — appends to the in-memory log, persists to storage, and sends a `DEBUG_ENTRY` message to the popup; `orchestrator` is stored on the entry and shown in the event log
- Exports types: `DebugEntry`, `ActivityScan`, `ActivityScanEntry`

### ui/popup.ts
- Real-time UI updates via `chrome.runtime.onMessage`
- Phase-based progress display: renders per-phase (Explore, Daily, Farm) progress bars and earned-points labels using `PHASE` / `PHASE_TIME_LABEL` from `util/state.ts`
- Delegates debug rendering to `ui/debug-panel.ts` and failure rendering to `ui/failure-banner.ts`
- **Skip warm-up** checkbox — persisted to `chrome.storage.local`; passed as `skipWarmUp` in the `START` message to background
- **Setup banner** — shown when a `'setup'`-category failure occurs (e.g. Chrome popup blocker blocked a tab); includes a button that opens `chrome://settings/content/popups`
- Start / Stop / Purge actions

### ui/debug-panel.ts
- `renderDebug()` — renders the full debug panel from stored state
- `appendLogEntry()` — appends a single entry to the event log in real time
- `renderActivitiesAndCounters()` — updates the Explore/Daily/PC Search sections with card breakdowns and counter data
- `clearDebug()` — clears all debug sections

### ui/failure-banner.ts
- `renderFailures()` — renders all stored failures in the failure banner
- `appendFailure()` — appends a single new failure in real time

### content/rewards-content.ts
- Bundled by esbuild — can freely import from `util/`
- Polls the rewards SPA until activity cards render (max 15s), extracts "Search on Bing" activities and daily set activities, sends them to background
- Retains two separate element arrays after extraction: `extractedCardEls` for Explore cards and `extractedDailySetEls` for daily set cards
- Handles `CLICK_CARD` (routes to the correct array based on `msg.target`), `VALIDATE_ACTIVITY`, and `GET_COUNTERS` messages on demand

### content/search-content.ts
- Bundled by esbuild — can freely import from `util/`
- Handles a single `PERFORM_SEARCH` message: fills the Bing search box and submits the form

## Making Changes

### Adjusting Timing

All timing uses `randMs(min, max)` with triangular distribution (defined in `util/timing.ts`). Named presets live in `TIMING` in `util/timing.ts`:

- **Page dwell**: `TIMING.LINGER_ON_PAGE` (`5–7s`) used by `lingerOnPage()` everywhere — before searches, after searches, between searches, on tile pages, after PC searches

### Modifying DOM Extraction

Edit `src/content/rewards-content.ts`:

- `MAX_WAIT_MS` — how long to wait for page load (default: 15s)
- `POLL_INTERVAL_MS` — how often to check for content (default: 500ms)
- `determineCardState()` — logic for classifying cards as actionable / completed / locked / unknown

### Modifying Query Generation

Edit `src/util/activity.ts` → `generateSearchQuery`:

- `BOILERPLATE` — regex patterns stripped from activity descriptions
- Minimum useful length threshold (`base.length < 8` falls back to title)
- Max query length (currently truncated to 80 chars)

## Testing

### Manual Testing
1. Make your changes in `src/`
2. Run `npm run build`
3. Reload the extension in `chrome://extensions`
4. Open the extension popup
5. Enable **Debug mode** to see detailed logs
6. Click **Run today's searches**
7. Monitor the debug panel for extraction results, search queue, and event log

### Testing Without Running Searches
To test activity extraction without running searches, add a return statement in `orchestrators/complete-explore-on-bing.ts` → `run` after the mapping step (after the `ACTIVITIES_MAPPED` message send):

```typescript
chrome.runtime.sendMessage({ action: MSG_ACTION.ACTIVITIES_MAPPED }).catch(() => {});
return; // Stop here for testing
```

### Resetting State
Use the **Purge all state** button in the debug panel to clear all stored data and reset to a fresh state.

## Version Release Checklist

When releasing a new version (e.g. `1.10.0` → `1.11.0`):

### 1. Study what changed

Find the last tag and read every commit diff since then:
```bash
git tag --sort=-version:refname | head -3       # find the last tag, e.g. v1.9.0
git log v1.9.0..HEAD --oneline                  # list commits since that tag
git log v1.9.0..HEAD --format="%H" | xargs -I{} git show {} --stat
```
Read the full diff for each commit — not just the stat, the actual code changes. You need this to write an accurate changelog and to know which sections of DEVELOP.md and README.md need updating.

### 2. Update docs (do this before touching version strings)

- **DEVELOP.md** — update every section that describes changed behavior: orchestrator docs, state docs, message passing, architecture notes, etc. Read the source files to verify claims before writing.
- **README.md** — update every user-facing description that no longer matches reality: the "What it does" steps, the flow diagram, the Notes section, Usage.
- **CLAUDE.md** — update Key Layers and Message Passing if architectural facts changed.

### 3. Write the changelog

Create `src/ui/screens/changelog-X.Y.Z.html` with a `<ul>` of **customer-facing** bullet points. Include only changes the user can see or feel — new UI features, behavior changes, bug fixes that affected real usage. Omit internal refactors, file reorganizations, linting, and code-quality-only changes. Base each bullet on actual code changes, not commit message summaries. Example:
```html
<ul>
  <li>Extension now opens as a side panel instead of a popup</li>
  <li>Fix daily set activities not being credited in many circumstances</li>
</ul>
```

### 4. Update version strings

- `manifest.json` → `"version"`
- `package.json` → `"version"`
- `docs/index.html` → `LATEST_VERSION`

### 5. Update the screens registry

In `src/util/screens.ts` → `SCREENS` array:
- Add entry for the new changelog: `{ id: 'changelog-X.Y.Z', title: "What's New in X.Y.Z", bodyFile: 'ui/screens/changelog-X.Y.Z.html' }`
- Remove the previous version's entry

Delete the previous version's changelog HTML file from `src/ui/screens/`.

### 6. Verify no stale version strings

```bash
git grep "OLD_VERSION"   # e.g. git grep "1.9.0"
```
Fix any remaining references. Ignore `package-lock.json` — it will show the old version but do **not** run `npm install` to update it; the lock file is updated as a side effect of the build step.

### 7. Build and tag

```bash
npm run build
git add manifest.json package.json docs/index.html src/util/screens.ts src/ui/screens/ DEVELOP.md README.md CLAUDE.md
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```
GitHub Actions will create the ZIP and GitHub Release automatically.

## Creating a Release

The build and tag steps are covered in the Version Release Checklist above. GitHub Actions will automatically create a ZIP and GitHub Release when the tag is pushed.

### Manual Release (fallback)

1. Go to the **Actions** tab in GitHub
2. Select **Build Release** workflow
3. Click **Run workflow**
4. Download the ZIP from the artifacts section

The workflow excludes `.git`, `.github`, and `.DS_Store` files from the ZIP.

## Debugging Tips

### Service Worker Console
1. Go to `chrome://extensions`
2. Find RewardFarm
3. Click **service worker** link (appears when active)
4. View console logs and errors

### Content Script Console
1. Open `rewards.bing.com` in a tab
2. Open DevTools (F12)
3. Go to Console tab
4. Filter by "content script" or check for errors

### Common Issues

**Extension shows "Running" but nothing happens**
- Service worker may have restarted. The in-memory `isActivelyRunning` flag is lost on restart.
- Click **Stop** then **Run today's searches** again.

**No activities extracted**
- Check if you're logged into Bing Rewards
- Bing may have changed their page structure — inspect `src/content/rewards-content.ts` extraction logic
- Enable debug mode to see DOM extraction stats

**Searches not credited**
- Increase post-search dwell time in `util/timing.ts`: raise `TIMING.LINGER_ON_PAGE`
- Check if you're logged into the correct Microsoft account
- Bing may have rate limiting — increase delays between searches

**"Not logged in" error**
- Sign into your Microsoft account at bing.com
- Ensure cookies are enabled
- Check if rewards.bing.com redirects you to a login page

## Architecture Notes

### State Management
- Persistent state stored in `chrome.storage.local` — includes `skipWarmUp` preference (survives resets; preserved across `resetState` calls alongside `seenScreenIds` and `ignoredUpdateVersion`)
- All storage writes are serialized through a `writeQueue` promise chain (`enqueueWrite()`) to prevent race conditions when multiple async operations try to write simultaneously
- Runtime state (`isActivelyRunning`, `activeOrchestrator`) lives in `util/state.ts` and resets on service worker restart
- `lastRunDate` comparison enables daily reset without manual clearing
- Phase progress (`PHASE.EXPLORE`, `PHASE.DAILY`, `PHASE.FARM`) and per-phase point totals are stored in `header.phases` and `header.phasePoints` and read by the popup for real-time display

### Tab Management
- All opened tabs tracked in `openedTabIds` Set
- The rewards tab stays open throughout the run so cards can be clicked on demand; closed after all cards are done
- Search tabs close automatically after each search completes
- Stop button closes all extension-opened tabs

### Message Passing
- `popup.ts` ↔ `background.ts`: bidirectional via `chrome.runtime.sendMessage`
- `background.ts` ↔ `rewards-content.ts`: bidirectional (`START_EXTRACT`, `CLICK_CARD` (optional `target: MSG_TARGET.DAILY_SET` to route to the daily-set element array), `VALIDATE_ACTIVITY` commands; `ACTIVITIES_FOUND` response)
- `background.ts` ↔ breakdown tab: `GET_COUNTERS` request/response via `fetch-counters.ts`
- `background.ts` → `search-content.ts`: one-way `PERFORM_SEARCH` command
- Real-time progress updates (`PROGRESS`, `LINGER_WAITING`, `ACTIVITIES_MAPPED`, `DEBUG_ENTRY`, `COMPLETE`) pushed to popup during run

### Randomization Strategy
- Triangular distribution (`randMs`) biases toward middle of range — more human-like
- `TIMING.INITIAL_DELAY` range (0–8s) is defined in `util/timing.ts` but not currently wired up

## Chrome Extension Manifest V3 Notes

This extension uses Manifest V3 (MV3), which has some key differences from V2:

- **Service workers** instead of background pages (no persistent background context)
- **Promises** required for most chrome APIs (no callbacks)
- **Host permissions** separate from general permissions
- Service workers can be terminated by Chrome at any time — state must be persisted

The extension handles service worker restarts by:
1. Storing all critical state in `chrome.storage.local`
2. Checking `isActivelyRunning` flag on popup open
3. Allowing mid-run resumption via `currentIndex` tracking
