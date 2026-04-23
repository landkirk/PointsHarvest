# Developer Guide

## Development Setup

1. Clone the repository
2. Run `npm install` to install dev dependencies (TypeScript, esbuild, concurrently, @types/chrome)
3. Run `npm run build` to do a full build, or `npm run extension:watch` for incremental compilation during development
4. Open Chrome and navigate to `chrome://extensions`
5. Enable **Developer mode** (toggle in top right)
6. Click **Load unpacked** and select the project folder (point at the repo root, not `src/`)
7. Make your changes to files in `src/`
8. Rebuild with `npm run build` (or let `watch` pick up the change), then click the refresh icon on the extension card

## Timing System

All timing uses a **human-like distribution algorithm** defined in `src/util/timing.ts`:

### Human Distribution (80% + 15% + 5%)
The extension simulates realistic human behavior by mixing three timing patterns:
- **80% triangular distribution**: Biased toward the middle of a range (realistic)
- **15% quick burst**: 30–70% of the minimum (user rushes through a step)
- **5% distracted pause**: 100–200% of the maximum (user gets distracted)

This creates a "long-tail" distribution that avoids detectable patterns like constant delays.

### Speed Multiplier
The extension supports configurable speed presets via `setTimingMultiplier()`:
- **Normal (1.0×)** — Default behavior
- **Fast (0.6×)** — Reduced delays (60% of base times)
- **Slow (4.0×)** — Extended delays (400% of base times)
- **Stealth (8.0×)** — Maximum delays (800% of base times, slowest humanization)

The speed multiplier is loaded from user preferences at run start and applied to most timing constants (via `randMs()`). **Exception**: `LINGER_ON_SEARCH` is **not scaled** and always uses `rawRandMs()` to maintain realistic search dwell times.

### TIMING Constants

All values are `[min, max]` in milliseconds at 1.0× multiplier. Multiply by `timingMultiplier` when called via `randMs()`.

| Constant | Range (ms) | Purpose |
|----------|-----------|---------|
| `LINGER_ON_PAGE` | 6,000–10,000 | Default dwell time on any page (tiles, results, etc.) |
| `LINGER_ON_SEARCH` | 3,000–6,000 | Dwell on Bing search results **not scaled by multiplier** |
| `DELAY_BETWEEN_FARMING_SEARCHES` | 4,000–8,000 | Pause between consecutive PC farm searches |
| `FETCH_COUNTERS_POLL` | 700–1,800 | Jittered interval between counter extraction polls |
| `REWARDS_PRE_EXTRACT_SCROLL_PAUSE` | 700–1,800 | Pause between scroll events before card extraction |
| `VALIDATE_ACTIVITY` | 1,400–3,800 | Delay after completing an activity before validating |
| `SCROLL_RANGE_PX` | 200–500 | Pixels to scroll per action during page dwell |
| `CLICK_SIMULATION_MOVE_DELAY` | 8–25 | Delay between pointer move events during card click |
| `CLICK_SIMULATION_HOLD_DOWN_DELAY` | 60–180 | Hold time between pointerdown and pointerup |
| `CLICK_SIMULATION_RELEASE_DELAY` | 10–40 | Delay after pointerup before final click event |
| `RESULT_CLICK_HOVER` | 500–1,500 | Pause after scrolling result into view, before clicking |
| `RESULT_CLICK_DWELL` | 2,000–6,000 | Additional dwell time after clicking an organic result |

### TIMEOUTS Constants

Fixed limits (not affected by speed multiplier):

| Constant | Value | Purpose |
|----------|-------|---------|
| `FETCH_ACTIVITIES` | 20,000 ms | Max wait for activity extraction on rewards page |
| `FETCH_COUNTERS_MAX_POLLS` | 20 | Max poll attempts for counter fetch (×700–1800 ms each = up to 36s) |
| `REWARDS_DOM_MAX_WAIT` | 15,000 ms | Max wait for DOM to render before starting extraction |
| `REWARDS_DOM_POLL` | 500 ms | Poll interval while waiting for DOM |
| `TAB_LOAD` | 30,000 ms | Default timeout for a tab to finish loading |
| `TAB_CAPTURE` | 10,000 ms | Max wait for a new tab to be created (card click) |
| `USER_ACTION_POLL` | 2 min | Timeout for user to complete a single-click activity (poll) |
| `USER_ACTION_QUIZ` | 10 min | Timeout for user to complete a quiz/test/puzzle |
| `PERMISSION_WAIT` | 10 min | Max wait for user to fix Chrome popup permissions |

## Build System

The project uses two tools for compilation:

- **tsc** — type-checks all source and emits `dist/` for everything except content scripts
- **esbuild** — bundles content scripts into self-contained files in `dist/content/`

Content scripts are bundled separately because Chrome injects them as classic scripts with no module loader. esbuild resolves all `import` statements at build time and emits a single IIFE per file, so they can freely import from `util/` and elsewhere without any runtime module system.

### Scripts

| Command | What it does |
|---|---|
| `npm run build` | Full extension build + marketing site build |
| `npm run extension:build` | Extension only: lint → `tsc --noEmit` → esbuild main + content scripts → copy assets |
| `npm run extension:watch` | `tsc --noEmit --watch` and `esbuild --watch` run in parallel via concurrently |
| `npm run extension:content` | Re-bundle content scripts only (useful after changing `util/` imports) |
| `npm run extension:watch:content` | Watch and re-bundle content scripts only |
| `npm run website:build` | Build the marketing site (`site/` → `docs/`) via Eleventy |
| `npm run website:watch` | Eleventy dev server at `localhost:8080` with live reload |
| `npm run website:preview` | `website:watch` and auto-open browser at `localhost:8080` |

The full `build` runs `extension:build` first (which starts with `tsc --noEmit`, so type errors in any file fail before anything is written to `dist/`), then `website:build`.

During `extension:watch`, the IDE handles content script type errors in real time; the watch pipeline handles fast re-emission on save.

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
    activity-extraction.ts       Opens rewards tab, waits for content script, classifies and stores activities
    complete-explore-on-bing.ts  Iterates mapped cards, clicks each, runs searches
    complete-daily-sets.ts       Opens each daily set tile; lingers for interactive ones
    complete-more-activities.ts  Opens More Activities tiles, dwells, and validates; skips interactive tile types
    farm-pc-searches.ts          Farms remaining PC search points after cards are done
    warm-up-searches.ts          Runs warm-up searches before the main Explore phase
  steps/
    fetch-counters.ts          Poll breakdown tab for search point counters
    perform-search.ts          Dwell and execute a single search in a tab
    linger-on-tab.ts           Pause automation and wait for user to complete a tile
    validate-activity.ts       Confirm an activity is marked complete on the rewards page
    wait-for-user-action.ts    Generic step for pausing until the user completes a required action
  util/
    activity-runner.ts  ActivityRunner class — executes an activity with optional retry logic
    activity.ts         Activity type, CardState enum, classifyCard(), enrichSearchQueries(), enrichUserActions()
    array.ts            Array utility helpers
    config.ts           URL constants (REWARDS_URL, REWARDS_BREAKDOWN_URL) and KEEPALIVE_PORT
    context.ts          createContext() — bundles setState/dbg/setHeaderMessage for orchestrators
    debug.ts            Logging helpers (dbg, resetLog) and debug type definitions
    failures.ts         Failure type and helpers
    messaging.ts        MSG_ACTION constants and MsgAction type
    persistent-state.ts chrome.storage.local persistent state + PHASE constants + write queue + resetState
    runtime-state.ts    In-memory runtime state (activeOrchestrator) — resets on service worker restart
    screens.ts          SCREENS array and OnboardingScreen interface
    search-queries.ts   PC_SEARCH_QUERIES pool used by farm-pc-searches
    tab-manager.ts      TabManager class — open/close/focus/capture tabs, wait for load
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
    failure-banner.ts   renderActionBanner(), renderFailures(), appendFailure()
    screens/            HTML fragments for onboarding screens (ToS, Bing warning, changelog)
  content/
    rewards-content.ts  Content script injected into rewards.bing.com (bundled by esbuild)
    search-content.ts   Content script injected into www.bing.com (bundled by esbuild)
dist/                   Compiled extension output (generated — do not edit)
site/                   Eleventy source for the marketing site (pointsharvest.com)
  _includes/              Layouts (base.njk, post.njk) and partials (nav, footer)
  _data/site.js           Global template data — baseUrl, version, download URL
  index.njk, contact.njk  Hand-written pages
  blog.njk                Blog listing page (iterates collections.posts)
  blog/                   Blog post markdown + directory data (blog.json)
  sitemap.njk             Generates sitemap.xml from the posts collection
  static/                 Passthrough-copied assets (site.css, CNAME, icons, JS)
eleventy.config.js      Eleventy config (input=site, output=docs, passthrough, filters)
docs/                   Generated marketing site output (gitignored; built and deployed by the Deploy Site workflow)
.github/workflows/      GitHub Actions for automated releases
```

## All Message Constants (MSG_ACTION)

The extension uses Chrome's `runtime.sendMessage` API for all cross-context communication. All message action constants are defined in `src/util/messaging.ts`:

| Action | Direction | Payload | Purpose |
|--------|-----------|---------|---------|
| `START_EXTRACT` | BG → rewards content | (none) | Trigger DOM extraction on rewards.bing.com |
| `ACTIVITIES_FOUND` | rewards content → BG | `{ cards: RawCard[], loggedIn: boolean }` | Return extracted card data to background |
| `CLICK_CARD` | BG → rewards content | `{ id: string }` | Click a card on rewards page, open its tab |
| `VALIDATE_ACTIVITY` | BG → rewards content | `{ id: string }` | Check if activity is marked complete |
| `GET_COUNTERS` | BG → rewards content | (none) | Extract search point counters from page |
| `PERFORM_SEARCH` | BG → search content | `{ query: string }` | Type query, submit search form |
| `SCROLL_PAGE` | BG → search content | `{ y: number, behavior: 'smooth' \| 'instant' }` | Scroll the page during dwell |
| `CLICK_RESULT` | BG → search content | (none) | Simulate click on top 3 organic result (35% CTR) |
| `START` | popup → BG | `{ skipWarmUp: boolean, windowId: number }` | Start a run with preferences |
| `STOP` | popup → BG | (none) | Cancel active run |
| `GET_RUN_STATE` | popup → BG | (none) | Fetch current run state |
| `GET_PREFERENCES` | popup → BG | (none) | Fetch user preferences |
| `PING` | popup → BG | (none) | Check if background is alive |
| `PURGE` | popup → BG | (none) | Clear all stored state |
| `USER_ACTION_COMPLETE` | popup → BG | (none) | User finished quiz/poll, resume automation |
| `RESET_STALE` | popup → BG | (none) | Clear stale run flag on service worker restart |
| `SET_PREFERENCE` | popup → BG | `{ updates: Partial<UserPreferences> }` | Update user preferences (timing, debug, etc.) |
| `PROGRESS` | BG → popup (push) | `ProgressBroadcast` | Broadcast run progress update (per-phase counts, header) |
| `DEBUG_ENTRY` | BG → popup (push) | `{ entry: DebugEntry }` | Append log entry to debug panel |
| `FAILURE_ENTRY` | BG → popup (push) | `{ failure: FailureEntry }` | Append failure to failure banner |

## Failure System

The extension records user-facing failures in a persistent queue. Failures are soft-fail events (non-fatal) that provide visibility into what went wrong without stopping the run.

### FailureEntry Structure

```typescript
interface FailureEntry {
  time: string;                 // ISO time of failure
  category: FailureCategory;    // one of 6 categories
  message: string;              // user-facing description
  orchestrator?: OrchestratorBase; // which phase (optional)
  step?: StepBase;              // which step (optional)
  activity?: Activity;          // which activity (optional)
}
```

### Failure Categories

Defined as the `FAIL` const in `src/util/failures.ts` (callers reference `FAIL.TAB`, `FAIL.AUTH`, etc.):

| Category | Examples |
|----------|----------|
| `FAIL.AUTH` | Not signed in, session expired (e.g. redirected away from rewards page) |
| `FAIL.PERMISSION` | Chrome popup blocker blocked an activity tab (has a dedicated fix-it banner) |
| `FAIL.TAB` | Tab didn't load, card click failed, rewards tab missing |
| `FAIL.SEARCH` | Search input failed, PC-farm counter fetch failed, farm stalled |
| `FAIL.VALIDATION` | Activity not marked complete after retry |
| `FAIL.FATAL` | Uncaught orchestrator/manager exception |

### Recording & Storage

- Failures are recorded via `ctx.fail(category, message)` called from anywhere in the orchestrator/step chain
- Each failure is timestamped, tagged with the active orchestrator/step/activity (read from `ctx` at call time)
- Max 50 failures stored per session (older ones shift out)
- Failures are persisted to `chrome.storage.local` and pushed to the popup in real time via `FAILURE_ENTRY` broadcast
- The popup's failure banner displays all recorded failures in a scrollable list

## Key Components

### background.ts
- Calls `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` on startup so clicking the extension icon opens the side panel
- Tab event listeners: load detection via `onUpdated`, tab removal via `onRemoved`, tab creation via `onCreated` — all delegated to `activeOrchestrator` if one exists
- Message routing: `START`, `STOP`, `GET_RUN_STATE`, `GET_PREFERENCES`, `PING`, `PURGE`, `USER_ACTION_COMPLETE`, `RESET_STALE`, `SET_PREFERENCE`
- Delegates all run logic to `managers/start-run.ts` and `managers/stop-run.ts`
- **Keepalive port**: listens for a long-lived `chrome.runtime.Port` named `KEEPALIVE_PORT` from the side panel; the popup sends heartbeat messages every 20s to prevent Chrome from terminating the service worker while the panel is open

### managers/start-run.ts
- Implemented as a `StartRun` class that owns a `TabManager` instance shared across all orchestrators
- Loads preferences at run start via `loadPreferences()` and applies the `timingMultiplier` via `setTimingMultiplier(prefs.timingMultiplier ?? 1.0)` so all downstream timing scales appropriately
- Resets run state to `INITIAL_RUN_STATE` (preserving preferences: `skipWarmUp`, `disableNotifications`, `debugMode`, `timingMultiplier`, `ignoredUpdateVersion`, `seenScreenIds`)
- Opens the rewards tab and focuses it before starting the orchestrator chain; all tabs are opened in the same window as the extension (the `windowId` is passed in the `START` message from the popup)
- Accepts a `skipWarmUp` flag (forwarded from the popup `START` message); when true, the `WarmUpSearches` orchestrator is skipped entirely and a log entry is written instead
- Fires `_executeRun` as fire-and-forget (returns immediately so background can ack the message)
- `_executeRun` chains six sub-orchestrators (ActivityExtraction → WarmUp → ExploreOnBing → DailySets → MoreActivities → FarmPcSearches) via `_runOrchestrator`, which sets/clears `activeOrchestrator` in `runtime-state.ts` around each run
- Records `startedAt` at the top of `run()` so `_endRun` can compute the run duration
- `_endRun(ctx, endReason)` takes a `RunEndReason` from the `RUN_END` enum (`success`, `stopped`, `not-logged-in`, `fatal`, `setup-failed`); the centralized `END_MESSAGES` table in the same file maps each reason to its status string and debug message
- On run end, builds a `RunSummary` via `buildRunSummary()` (from `util/run-summary.ts`) and persists it to `runState.lastRunSummary` alongside the final header state in a single `setRunState()` call
- Closes all opened tabs with staggered random delays (300–1200 ms between closes) to avoid bot-detection patterns
- Sends a desktop notification on success (controlled by `disableNotifications` preference)

### managers/stop-run.ts
- Guards against double-stop: if there is no active controller, or the existing one is already aborted, returns immediately (so clicking Stop twice is a no-op)
- Aborts the active controller with `StoppedError`, clears `isLingering`, and sets header message to `"Stopping…"` (the final `"Stopped"` message is written later by `_endRun`)
- Invokes the active orchestrator's `stop()` hook with an aborted context
- Calls `tabs.closeAll()` and closes the rewards tab if one is tracked
- Broadcasts progress so the popup reflects the stopping state immediately

### orchestrators/activity-extraction.ts
- Runs once at the start of every run to extract and classify activities from rewards.bing.com
- Scrolls the rewards page twice (700–1800 ms pauses between scrolls) before extraction to ensure all cards render
- Sends `START_EXTRACT` to the content script and waits up to 20s for `ACTIVITIES_FOUND` response containing `{ cards: RawCard[], loggedIn: boolean }`
- Throws `NotLoggedInError` if rewards page redirects away from `rewards.bing.com` (e.g., user not logged in)
- Classifies each raw card via `classifyCard()` into `EXPLORE_ON_BING`, `DAILY_SET`, `MORE_ACTIVITIES`, or `IGNORED` based on title/description patterns and source
- Enriches explore cards with `searchQuery` and `fallbackQuery` via `enrichSearchQueries()`
- Enriches daily cards with `requiresUserAction`, `userActionKind`, and `userActionTimeoutMs` via `enrichUserActions()`; `userActionKind` is one of `'quiz' | 'poll' | 'puzzle' | null` (cards matching `test` are folded into `quiz`). Timeout is 2 min for polls, 10 min for quizzes/puzzles.
- Stores the full `ActivityState` (all cards, rewardsTabId, loggedIn flag) to persistent storage for downstream orchestrators
- Logs extraction stats (total, explore, daily, ignored counts) and unmapped card count

### orchestrators/complete-explore-on-bing.ts
- Runs after activity extraction to complete "Search on Bing" activities
- Filters for actionable explore cards (`activityType === EXPLORE_ON_BING`, `cardState === Actionable`)
- Iterates each activity:
  - Uses `TabManager.clickCardAndCaptureTab()` to send `CLICK_CARD` message and capture the resulting search tab
  - If tab creation blocked by Chrome popup blocker (`TabCaptureStatus.Blocked`), calls `_waitForPopupUnblock` to pause and prompt user to enable popups, then **retries** `clickCardAndCaptureTab` once. Only a non-`Ok` status after the retry counts as failure, so cards are no longer silently skipped when the user fixes popup permissions.
  - Calls `steps/perform-search` with the search query (or fallback query if primary fails)
  - Validates completion via `ActivityRunner.executeActivityWithValidation()` with retry logic (retry function runs another search with fallback query if available)
  - Updates per-phase progress header after each activity
- Closes all search tabs after completion

### orchestrators/complete-daily-sets.ts
- Runs to complete daily set activities (quizzes, polls, surveys, offers, etc.)
- Filters for actionable daily set cards (`activityType === DAILY_SET`, `cardState === Actionable`)
- Iterates each activity:
  - Uses `TabManager.clickCardAndCaptureTab()` to click the card on rewards page and capture the activity's page
  - If tab blocked by popup blocker, calls `_waitForPopupUnblock`
  - Classifies the activity as user-interactive or auto-closeable based on title matching `quiz|poll|test|puzzle`
    - **User-interactive**: calls `steps/linger-on-tab` to activate the tab and wait for user to click **Done** (timeout: 2 min for polls, 10 min for quizzes from `enrichUserActions()`)
    - **Auto-closeable**: calls `lingerOnPage()` (standard 6–10s dwell), then closes the tab
  - Validates completion via `ActivityRunner` after each activity
  - Tracks phase progress (done vs total)

### orchestrators/complete-more-activities.ts
- Runs after Daily Sets to complete "More Activities" tiles on the rewards page
- Filters for actionable more-activities cards (`activityType === MORE_ACTIVITIES`, `cardState === Actionable`)
- Skips tiles whose title or description matches any skip keyword: `puzzle`, `quiz`, `browser extension`, `set bing`, `install`, `play` — logged as a warning; never clicked
- For each remaining tile:
  - Uses `TabManager.clickCardAndCaptureTab()` to click the tile; the href is a pre-built Bing search URL so the results page loads immediately — no `performSearch` needed
  - If tab blocked by popup blocker, calls `_waitForPopupUnblock`
  - Dwells 6–10s (`TIMING.LINGER_ON_PAGE`), closes the tab, and validates completion
  - Retries once on validation failure via `executeWithRetry` (same pattern as daily sets)
- No user-interaction path — every tile type that requires manual input is already in the skip list

### orchestrators/farm-pc-searches.ts
- Runs after all activity cards to maximize PC search points by farming until the daily cap is reached
- Opens a breakdown tab (or reuses existing) and polls counters to determine available remaining capacity
- Runs searches in a loop with random queries from `PC_SEARCH_QUERIES` pool
- Stops when:
  - Counter reaches max (cap achieved)
  - No progress detected for 3 consecutive searches (surface failure and continue to next orchestrator)
  - Run is aborted or error occurs
- Each search runs via `steps/perform-search` with dwell and optional CTR click

### steps/fetch-counters.ts
- Polls the breakdown tab to extract current search point counters
- Sends `GET_COUNTERS` message to the breakdown tab (rewards content script)
- Polls up to 20 times with jittered intervals (700–1800 ms) using `randMs(TIMING.FETCH_COUNTERS_POLL)`
- Normalizes counter values by dividing by `PC_SEARCH_POINTS_PER_SEARCH` (5 points per search) to convert from point values to search counts
- Returns `SearchCounter[]` with structure: `{ type, current, max, currentPoints, maxPoints }`
- Logs counter state after successful extraction
- On timeout (20 polls without valid response), records a `FAIL.SEARCH` failure

### steps/validate-activity.ts
- Validates that an activity is marked complete after its dwell period
- Activates the rewards tab, waits 1.4–3.8s jitter (`randMs(TIMING.VALIDATE_ACTIVITY)`), then sends `VALIDATE_ACTIVITY` message to rewards content script
- Returns `ActivityValidationResult` enum (`Completed`, `Incomplete`, or `Error`):
  - `Completed`: Card shows completed state (points-earned span present)
  - `Incomplete`: Card still shows actionable/in-progress state (activity not credited)
  - `Error`: No response or card not found
- Logs validation result with activity ID and title for debugging

### steps/linger-on-tab.ts
- Pauses automation and waits for user to complete an interactive activity (quiz, poll, puzzle)
- Signature: `lingerOnTab(ctx, tabId, activity)` — the timeout is read from `activity.userActionTimeoutMs` (set by `enrichUserActions()`: 2 min for polls, 10 min for quizzes/puzzles)
- Header message is built from the activity: `Complete the {userActionKind} "{truncated title}" in the Bing tab, then click Done.` (e.g. `Complete the quiz "Which movie won Best Picture?" in the Bing tab, then click Done.`). Falls back to `'activity'` if `userActionKind` is null.
- Activates the tab so it's visible to the user
- Resolves when:
  - User clicks **Done** button in popup (sends `USER_ACTION_COMPLETE` message), OR
  - User manually closes the tab (detected via `onTabRemoved` listener), OR
  - Timeout expires
- Returns a resolver handle `{ promise, resolve }` so caller can early-exit on stop

### steps/perform-search.ts
- Executes a complete search: dwell → search → dwell → optional CTR click
- Pre-search dwell: calls `lingerOnPage()` with `TIMING.LINGER_ON_SEARCH` (3–6s, **not scaled** by speed multiplier to maintain realistic search dwell)
- Sends `PERFORM_SEARCH` message to search tab content script with the query string
- If search fails, records a `'search'` failure with error details
- Post-search dwell: calls `lingerOnPage()` with standard dwell (scaled), with `onStart` callback that schedules 2–3 scroll events at random points during the dwell window
- **CTR simulation**: 35% chance to click an organic result from top 3 results, then wait 2–6s additional dwell (`TIMING.RESULT_CLICK_DWELL`)
- Scrolling details:
  - 2 or 3 scrolls with 50% probability each
  - Total scroll distance: 300–900 px
  - Individual scroll: `totalPx / count` per event
  - Scroll times: randomly distributed across 20–80% of dwell window
  - 20% chance of an upward scroll near end of dwell (25% of total downward distance)
  - All scroll sends are fire-and-forget; failures silently ignored

### steps/wait-for-user-action.ts
- Generic step for pausing until the user completes a required action (e.g. fixing popup permissions, signing in)
- `UserActionConfig` — data-driven config: `headerMessage`, `bannerTitle`, `bannerInstructions`, `actionButtonLabel`, `actionButtonUrl`, `failureCategory`, `failureMessage`, `timeoutMs`, `theme`
- `waitForUserAction(ctx, config)` — sets `isLingering: true` and `activeUserAction` on RunState, waits for Done (`USER_ACTION_COMPLETE`) or timeout, then clears both
- Factory functions: `popupBlockedAction(label)` (amber theme, FAIL.PERMISSION) and `notLoggedInAction()` (danger theme, FAIL.AUTH)
- Called via `OrchestratorBase._waitForUserAction(ctx, config)` which also records the failure and clears it on completion

### util/context.ts
- `createContext(signal)` returns a `Context` object that bundles all orchestrator/step utilities:
  - `signal: AbortSignal` — allows stops to propagate (throw errors in awaited code)
  - `activeOrchestrator`, `activeStep`, `activeActivity` — tracked from caller (read-only for logging)
  - `setState(updates)` — persist partial run state to `chrome.storage.local`
  - `dbg(type, message)` — log to debug panel, auto-tagged with active orchestrator name
  - `fail(category, message)` — record soft failure with category, message, and context (orchestrator/step/activity)
  - `updateHeader(payload)` — update header state and phase progress, then broadcast to popup
  - `broadcastProgress()` — push current header state to popup via `PROGRESS` message
- All methods respect the abort signal, so stopping a run propagates cleanly through the entire orchestrator chain

### util/persistent-state.ts
- **Preferences & Run State**: Separated into two independent storage objects
  - `UserPreferences`: `skipWarmUp`, `disableNotifications`, `debugMode`, `timingMultiplier`, `ignoredUpdateVersion`, `seenScreenIds` — survives `resetRunState()`
  - `RunState`: `isRunning`, `isLingering`, warmUpQueries, searchCounters, rewardsTabId, activityState, failures, header, debug, `lastRunSummary` — cleared on run start
- `loadPreferences()` / `setPreference(updates)` — load/save user preferences
- `loadRunState()` / `setRunState(updates)` — load/save run state; all writes serialized through `enqueueWrite()` to prevent race conditions
- `resetRunState(overrides)` — reset all run fields to `INITIAL_RUN_STATE` (preserves preference keys; storage.local.set is additive)
- `setHeaderState()` / `getHeaderState()` — deep-merge updates to header subobject (headerMessage, activePhase, phases, phasePoints)
- `setDebugState()` / `getDebugLog()` / `getFailures()` — accessors for debug and failure sub-state
- `PHASE` constants: `'warmup'`, `'explore'`, `'daily'`, `'more-activities'`, `'farm'` — used as keys in `PhaseProgressMap` and `PhasePointsMap`
- `PHASE_KEYS: readonly PhaseKey[]` — exported tuple of all phase keys in order, used by the popup to iterate rows
- `PHASE_LABELS: Record<PhaseKey, string>` — display names (`'Warm-up'`, `'Explore on Bing'`, `'Daily Sets'`, `'More Activities'`, `'PC Searches'`) used by the run summary card
- `RUN_END` constants and `RunEndReason` type: `'success' | 'stopped' | 'not-logged-in' | 'fatal' | 'setup-failed'` — passed into `_endRun` and stored on `RunSummary.endReason`
- `RunSummary` interface — persisted to `runState.lastRunSummary` at the end of every run: `{ startedAt, endedAt, endReason, phases, phasePoints, activityCounts: { dailySetsCompleted, exploreCompleted, moreActivitiesCompleted, locked, actionableLeftover }, failureCount }`

### util/runtime-state.ts
- `activeOrchestrator` / `activeContext` — in-memory only (not persisted); reset on service worker restart
- `getActiveOrchestrator()` / `setActiveOrchestrator()` — tracks which orchestrator is currently executing; used by `context.dbg()` to label log entries with orchestrator name

### util/tab-manager.ts
- `TabManager` class — owns all tab lifecycle operations and state
- **Core operations**:
  - `openTab(url)` — create new tab, track it, return it; throw if creation fails
  - `closeTab(tabId)` — close tab and untrack it
  - `focusTab(tabId)` — activate tab (make it visible to user)
  - `untrackTab(tabId)` — stop tracking a tab without closing (e.g., user closed it)
  - `openAndFocusTab(url)` — open, wait for load, then focus
  - `setWindowId(id)` — pin manager to a specific window so all new tabs open there
- **Complex operations**:
  - `clickCardAndCaptureTab(ctx, rewardsTabId, id, label)` — send `CLICK_CARD` message to rewards content script, wait for new tab to be created (up to 10s), wait for that tab to load (up to 30s), focus it, return `TabCaptureResult` discriminated union:
    - `{ status: 'ok', tab }` — success, tab is ready
    - `{ status: 'blocked' }` — tab creation blocked by Chrome popup blocker; caller should pause and wait for user fix
    - `{ status: 'failed' }` — card click message failed or tab didn't load; call `ctx.fail()`
  - `assertTabExists(ctx, tabId, phase)` — check if tab still exists; call `ctx.fail()` if not
  - `closeAll()` — close all tracked tabs with staggered random delays (300–1200 ms between each close) to simulate human behavior and avoid bot detection
- **Signal integration**: All waits (`_waitForTabLoad`, `_captureNextTab`) respect the `AbortController` signal, allowing stops to abort waiting code immediately

### util/activity-runner.ts
- `ActivityRunner` class — executes activity functions with validation and optional retry logic
- `executeActivityWithValidation(ctx, activityFn, retryFn, opts)` — pattern for execute-validate-retry:
  - Calls `activityFn()` and waits for boolean result
  - If succeeds (`true`), returns `true` immediately
  - If fails (`false` or `null`) and no retry available, records failure and returns `false`
  - If fails and retry available, logs warning, lingers (standard dwell), then calls `retryFn()`
  - If retry also fails, records failure and returns `false`
  - Catches exceptions as tab errors (records `FAIL.TAB` category failure)
- **Options**:
  - `retryLogMessage` — debug message before retry linger
  - `lingerLabel` — label for retry linger dwell
  - `failCategory` — failure category if validation fails
  - `failMessage` — user-facing failure message
  - `noRetryFailMessage` — override message when no retry (optional)
  - `navFailMessage` — message if activityFn throws (optional)
  - `retryNavFailMessage` — message if retryFn throws (optional)
  - `retryHeaderPayload` — optional header update to send before retry linger

### util/config.ts
- URL constants (`REWARDS_URL`, `REWARDS_BREAKDOWN_URL`) and `KEEPALIVE_PORT` name shared across modules

### util/search-queries.ts
- `PC_SEARCH_QUERIES` — pool of queries used by `farm-pc-searches.ts`

### util/debug.ts
- `dbg(type, message, orchestrator?)` — appends to the in-memory log, persists to storage, and sends a `DEBUG_ENTRY` message to the popup; `orchestrator` is stored on the entry and shown in the event log
- Exports types: `DebugEntry`

### ui/popup.ts
- Main side panel UI that displays run state, phase progress, and provides Start/Stop buttons
- Real-time updates via `chrome.runtime.onMessage` listening for `PROGRESS`, `DEBUG_ENTRY`, `FAILURE_ENTRY` broadcasts
- **Header**: includes a link to the Bing Rewards Dashboard (`rewards.bing.com`) for quick manual access
- **Phase-based progress display**:
  - Renders per-phase (Warmup, Explore, Daily, Farm) progress bars (`done / total`) and earned-points labels
  - Uses `PHASE` constants and `PHASE_TIME_LABEL` for display labels
  - **Animated earnings counter**: when a phase's earned points increase, `animatePhaseEarned(phase, from, to)` smoothly counts the number up over 650 ms with cubic ease-out and adds an `earning` CSS class to the phase row for the duration. `animHandles` / `animDisplayed` track the in-flight `requestAnimationFrame` handle and the currently-displayed value per phase so mid-animation updates continue from the current display value instead of jumping. `stopPhaseAnim(phase)` cancels any pending frame and removes the class (called on stop and on run start).
- **Run summary card**: after a run ends, the popup reads `lastRunSummary` from run state and delegates to `renderRunSummaryCard()` in `ui/run-summary-card.ts` to display the recap
- **User preferences panel** (`prefs-panel.ts`):
  - **Skip warm-up** checkbox — persisted to preferences; passed as `skipWarmUp` in `START` message
  - **Speed multiplier** select (Normal 1.0×, Fast 0.6×, Slow 4.0×, Stealth 8.0×) — persisted to `timingMultiplier` in preferences
  - **Debug mode** checkbox — enables verbose logging
  - **Disable notifications** checkbox — suppresses desktop notifications on run completion
- **Action banner** — data-driven banner shown when `activeUserAction` is set on RunState (e.g., popup blocked, not logged in); renders title, instructions, and action button from `UserActionConfig`; themed via `.theme-amber` or `.theme-danger` CSS classes; clears when the user action completes
- **Keepalive port**:
  - Opens long-lived `chrome.runtime.Port` named `KEEPALIVE_PORT` on load
  - Sends heartbeat every 20s to prevent Chrome from killing the service worker while panel is open
  - Listens for any messages to detect when popup closes
- **Startup flow**:
  - Calls `chrome.windows.getCurrent()` to get `windowId`
  - Sends `START` message with `{ skipWarmUp, windowId }` to background
  - Listens for `PROGRESS` broadcasts to update phase progress in real time
- **Actions**: Start (with windowId), Stop, Purge all state
- Delegates debug panel rendering to `ui/debug-panel.ts` and failure rendering to `ui/failure-banner.ts`

### ui/prefs-panel.ts
- Renders user preferences panel in the popup
- Displays and handles updates for:
  - `skipWarmUp` checkbox
  - `timingMultiplier` select dropdown (Normal, Fast, Slow, Stealth presets)
  - `debugMode` checkbox
  - `disableNotifications` checkbox
- Sends `SET_PREFERENCE` messages to background for each update
- Loads current preferences on panel load via `GET_PREFERENCES` message

### ui/debug-panel.ts
- `renderDebug()` — renders the full debug panel from stored state:
  - Event log section (timestamps, messages, associated orchestrator names)
  - Activities breakdown section (explore vs daily card counts, actionable vs completed vs locked)
  - Search counters section (PC search current/max)
- `appendLogEntry(entry)` — appends a single new entry to the event log in real time (called on `DEBUG_ENTRY` message)
- `renderActivitiesAndCounters()` — re-renders the activities and counters sections (called when extraction completes or counters update)
- `clearDebug()` — clears all sections

### ui/failure-banner.ts
- `renderActionBanner(config)` — data-driven banner for active user actions (popup blocked, not logged in); themed via `.theme-amber` / `.theme-danger` CSS classes; skips DOM updates when config hasn't changed
- `renderFailures(failures, suppressCategory?)` — renders all failures in the failure banner, optionally suppressing a category already shown by the action banner
- `appendFailure(failure)` — appends a single new failure to the banner in real time (called on `FAILURE_ENTRY` message); suppresses the active action's failure category
- Each failure displays: time, category badge, message, and context (orchestrator/step/activity if available)
- Scrollable list (height-constrained) to show recent failures

### ui/run-summary-card.ts
- `renderRunSummaryCard(summary: RunSummary)` — builds and injects the end-of-run recap card into the popup after a run ends
- Reads `lastRunSummary` from run state; formats the duration via `formatDuration()` from `util/format.ts` (`Xh Ym Zs` / `Ym Zs` / `Zs`)
- Displays end reason (success / stopped / not-logged-in / fatal / setup-failed), per-phase points via `PHASE_LABELS`, and activity counts: daily sets completed, explore cards completed, locked, and any actionable leftovers
- Shows the total failure count so the user can see at a glance whether the run had any soft failures

### content/rewards-content.ts
- Bundled by esbuild as an IIFE (cannot use ES modules; Chrome MV3 limitation)
- **Initialization**: Waits for rewards.bing.com SPA to render activity cards (polls DOM every 500ms up to 15s)
- **Pre-extraction scrolling**: Scrolls the page twice with 700–1800 ms pauses between scrolls to ensure all cards load and are visible
- **Card extraction** (`START_EXTRACT` handler):
  - Extracts all actionable and locked cards from three sections:
    - **Explore section** (main cards): `<a class="ds-card-sec">` and `.locked-card` elements outside the daily-sets and more-activities containers
    - **Daily sets section** (`#daily-sets`): tiles for quizzes, polls, surveys, offers
    - **More activities section** (`#more-activities`): additional activity tiles with pre-built search URLs; cards use id prefix `M1–MN` and `source: CARD_SOURCE.MORE_ACTIVITIES`
  - Each card yields a `RawCard` with fields: `id` (E1–EN for explore, D1–DN for daily), `title`, `description`, `points`, `cardState`, `source`, `dataBiId`
  - Classifies card state via `determineCardState()`:
    - `Locked` — `.locked-card` parent or `aria-disabled="true"`
    - `Completed` — contains `[aria-label="Points you have earned"]`
    - `Actionable` — contains `[aria-label="Points in progress"]` or `[aria-label="Points you will earn"]`
    - `Unknown` — no state indicator found
  - Caches element references in `extractedEls` Map for later clicking
  - Returns `ACTIVITIES_FOUND` message with `{ cards: RawCard[], loggedIn: true }`
- **Card click handler** (`CLICK_CARD` message):
  - Retrieves element from `extractedEls` cache by card ID
  - Simulates realistic mouse/pointer events for clicking:
    - `pointerover`, `mouseover` — hover events
    - 1–3 `pointermove` / `mousemove` events at ±3px offset (jitter)
    - `pointerdown`, `mousedown` — press down
    - `pointerup`, `mouseup` — release
    - `click` — final click event
  - Delays between events: 8–25ms per move, 60–180ms hold, 10–40ms after release (all from `TIMING`)
  - Returns `{ clicked: true }` on success
- **Activity validation handler** (`VALIDATE_ACTIVITY` message):
  - Looks up card by ID in `extractedEls` cache
  - Re-checks current card state via `determineCardState()`
  - Returns `{ state: CardState }` (Completed, Actionable, Locked, Unknown, NotFound)
- **Counter extraction handler** (`GET_COUNTERS` message):
  - Extracts search point counters from counter cards (`.pointsBreakdownCard`)
  - Parses title (e.g., "PC searches") and detail text (e.g., "5 / 150")
  - Returns `{ searchCounters: [{ type, current, max }, ...] }`
- **DOM Selectors**:
  - `#daily-sets` — daily sets container
  - `a.ds-card-sec` — actionable card
  - `.locked-card` — locked card wrapper
  - `[aria-label="Points you have earned"]` — completed indicator
  - `[aria-label="Points in progress"]` — actionable indicator
  - `[aria-label="Points you will earn"]` — actionable indicator
  - `.pointsBreakdownCard` — counter card
  - `.title-detail p` — counter title
  - `p.pointsDetail` — counter detail (e.g., "5 / 150")
  - `.pointsString` — points value in card

### content/search-content.ts
- Bundled by esbuild as an IIFE (cannot use ES modules)
- **Search handler** (`PERFORM_SEARCH` message):
  - Finds search input: `#sb_form_q` (preferred) or `textarea[name="q"]` (fallback)
  - Clears existing text by simulating Ctrl+A + Delete
  - Types query character by character with human-like delays:
    - Standard keystroke: 40–120 ms per character
    - 5% chance of hesitation pause: 200–400 ms per character
    - Dispatches `keydown`, `input`, `keyup` events for each character
  - Pauses 150–300 ms before submitting form via `requestSubmit()`
  - Returns `{ ok: true }` or `{ ok: false, error: string }`
- **Scroll handler** (`SCROLL_PAGE` message):
  - Scrolls page by `msg.y` pixels using `window.scrollBy({ top, behavior })`
  - Behavior can be `'smooth'` or `'instant'`
  - Returns `{ ok: true }`
- **Result click handler** (`CLICK_RESULT` message, 35% CTR simulation):
  - Selects organic results from `#b_results .b_algo h2 a` (top 3 only, to avoid spam-like behavior)
  - Scrolls selected result into view (`smooth` centering)
  - Pauses 500–1500 ms (hover time from `TIMING.RESULT_CLICK_HOVER`)
  - Dispatches pointer/mouse events (same sequence as card click: over, move, down, up, click)
  - Returns `{ ok: true }` or `{ ok: false, error: string }`
- **DOM Selectors**:
  - `#sb_form_q` — primary search input
  - `textarea[name="q"]` — fallback search input
  - `#sb_form` — search form
  - `#b_results .b_algo h2 a` — organic result links

## Making Changes

### Adjusting Timing

All timing constants are defined in `src/util/timing.ts`:

1. Edit `TIMING` object to adjust ranges (min, max in milliseconds at 1.0× multiplier):
   - Most constants are scaled by `timingMultiplier` when called via `randMs()`
   - `LINGER_ON_SEARCH` is **intentionally not scaled** — use `rawRandMs()` in `perform-search.ts` to maintain realistic search dwell
   - Timeouts (fixed limits) live in `TIMEOUTS` object and are never scaled

2. Example: To slow down page dwell for testing stealth mode:
   - Edit `TIMING.LINGER_ON_PAGE: [6000, 10000]` → `[12000, 20000]`
   - Or rely on speed multiplier: user selects "Stealth 8.0×" in UI to multiply existing delays by 8×

### Modifying DOM Extraction

Edit `src/content/rewards-content.ts`:

- **Selectors** (top of file): Update `SELECTORS` object if Bing changes DOM structure
- **Card state logic** (`determineCardState()`): Adjust conditions for `Locked`, `Completed`, `Actionable`, `Unknown`
- **Timing** (`TIMING.REWARDS_PRE_EXTRACT_SCROLL_PAUSE`): Pause between pre-extraction scrolls (if cards still not rendering, increase this)
- **Scroll count** (in activity-extraction.ts): Currently scrolls twice before extraction; increase if Bing's infinite scroll needs more time

### Modifying Search Query Generation

Edit `src/util/activity.ts` → `generateSearchQuery()`:

- `BOILERPLATE` array — regex patterns to strip from activity descriptions (e.g., "Search on Bing for…")
- `MIN_QUERY_LENGTH` (8) — threshold below which to fall back to title instead of description
- Max query length (currently 80 chars slice) — increase if longer queries are desired

### Adding a New Orchestrator

1. Create `src/orchestrators/my-orchestrator.ts` extending `OrchestratorBase`
2. Implement `async run(ctx: Context): Promise<void>`
3. Use `ctx.dbg()`, `ctx.fail()`, `ctx.updateHeader()` for logging and progress
4. Add to orchestrator chain in `managers/start-run.ts` → `_executeRun()` via `_runOrchestrator()`
5. The `_runOrchestrator()` helper sets `activeOrchestrator` so context logging auto-tags entries

### Adding a New Step

1. Create `src/steps/my-step.ts` extending `StepBase`
2. Implement `async run(ctx: Context, ...args): Promise<ReturnType>`
3. Use `ctx.dbg()` and `ctx.fail()` for logging
4. Export an instance: `export const myStep = new MyStep()`
5. Call from orchestrator: `await myStep.run(ctx, arg1, arg2)`

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
To test activity extraction without running searches, add a return statement in `orchestrators/complete-explore-on-bing.ts` → `run` after the mapping step (after `ctx.setState({ activityState: extraction })`):

```typescript
await ctx.setState({ activityState: extraction });
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
- **README.md** — update every user-facing description that no longer matches reality: the "What it does" list, Usage, Settings, and Tips sections.
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

The marketing site version (shown in the homepage download button and install step) is read from `package.json` by `site/_data/site.js` at build time — no manual update needed. `docs/sitemap.xml` is regenerated by Eleventy from `site/sitemap.njk` + `collections.posts`, so new pages or posts appear there automatically after the next build.

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
git add manifest.json package.json src/util/screens.ts src/ui/screens/ DEVELOP.md README.md CLAUDE.md
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
2. Find Points Harvest (or RewardFarm if it's your fork)
3. Click **service worker** link (appears when active)
4. View console logs and errors (errors from `ctx.fail()` calls are logged via `dbg(DBG.ERROR, ...)`)

### Content Script Console
1. Open `rewards.bing.com` or `www.bing.com` in a tab
2. Open DevTools (F12)
3. Go to Console tab
4. Look for console.warn logs from `[rewards-content]` or `[search-content]` (they output selector warnings if extraction fails)
5. Check for errors from message handlers (if message fails, check content script is loaded)

### Debug Mode
- Enable in popup **Preferences** panel: **Debug mode** checkbox
- Shows detailed event log in Debug panel with timestamps and orchestrator names for each log entry
- View via popup's Debug tab
- Helpful for tracing which orchestrator/step failed and when

### Failure Banner
- Displays all soft failures (non-fatal errors) with timestamps, categories, and messages
- Updated in real time as failures occur
- Useful for understanding why activities didn't complete (e.g., "Card click failed for E5", "Validation failed: state='actionable'")

### Common Issues

**Extension shows "Running" but nothing happens**
- Service worker may have restarted or been terminated by Chrome
- Popup will show `isLingering: true` if stuck waiting for user action
- Check failure banner for recorded errors
- Click **Stop** then **Run today's searches** again

**No activities extracted**
- Check if logged into Bing Rewards (failure: "Not logged in — redirected to: ...")
- Enable debug mode; check "Activities found" section
- If DOM extraction times out: check rewards.bing.com page structure; Bing may have changed class names
- Increase `TIMEOUTS.REWARDS_DOM_MAX_WAIT` (15s) if page renders slowly

**Searches not credited (validation failures)**
- Check activity timeout: Explore cards need 1–2 min, Daily (quiz) up to 10 min
- Increase post-search dwell `TIMING.LINGER_ON_PAGE` if validation checks too quickly
- Check "Search counters" in debug panel — if counter isn't increasing, Bing may not have credited search
- Enable debug mode to see validation log: "Validation failed: state='actionable'" means Bing didn't mark complete

**"Not logged in" error on start**
- Sign into your Microsoft account at bing.com first
- Ensure cookies are enabled in Chrome
- Check if rewards.bing.com automatically redirects you to login page
- Failure banner will show: "Not logged in — redirected to: [url]"

**Popup blocker blocked card**
- Failure banner shows: "Tab blocked by popup blocker for: [activity]"
- Popup displays setup banner with button to open Chrome popup settings
- Fix: Open `chrome://settings/content/popups`, find `bing.com`, and allow popups
- Click **Done** in popup after fixing permissions; run will resume

**"No response" or message failures**
- Check content script is loaded: refresh page (F5) on rewards.bing.com or bing.com
- Rebuild extension: `npm run build` then reload in chrome://extensions
- Check web console (DevTools) for errors from content script
- Failure will be logged: "Card click message error: no response"

**Activity stuck on user-action (quiz/poll/puzzle)**
- Popup header shows a specific message like `Complete the quiz "..." in the Bing tab, then click Done.`
- User must click **Done** button in popup after completing the activity (or close the tab directly)
- If timeout expires (2 min for polls, 10 min for quizzes/puzzles), failure is recorded and run continues
- If user never completes, tab must be closed manually to unstuck run (then click **Stop**)

## Architecture Notes

### State Management
Split into two independent persistent objects in `chrome.storage.local` (via `util/persistent-state.ts`):

**UserPreferences** (survives run resets):
- `skipWarmUp`, `disableNotifications`, `debugMode`, `timingMultiplier`
- `ignoredUpdateVersion` (for update notifications)
- `seenScreenIds` (for onboarding screens)
- Loaded at run start via `loadPreferences()`
- Updated via `setPreference(updates)`

**RunState** (cleared at start of each run via `resetRunState()`):
- `isRunning`, `isLingering` — phase flags
- `warmUpQueries` — pre-generated queries for warm-up phase
- `searchCounters` — PC search current/max (updated by counter fetch)
- `rewardsTabId` — ID of rewards tab
- `activityState` — extracted activities and rewards tab ID
- `failures` — list of soft failures (max 50)
- `header` — run progress state:
  - `headerMessage` — current status message
  - `activePhase` — currently executing phase (`'warmup'` | `'explore'` | `'daily'` | `'more-activities'` | `'farm'` | null)
  - `phases` — per-phase progress (`{ warmup: null, explore: { done, total }, ... }`)
  - `phasePoints` — per-phase earned points (`{ warmup: 0, explore: 50, ... }`)
- `debug` — debug log entries
- `lastRunSummary` — `RunSummary` from the most recent run (or `null` if none). Written by `_endRun` and consumed by the popup to render the end-of-run summary card.

**Runtime state** (`util/runtime-state.ts`, in-memory only):
- `activeOrchestrator` — which orchestrator is currently running (resets on service worker restart)
- `activeContext` — context object passed to orchestrators (for accessing signal, fail methods)

**Write serialization**:
- All storage writes enqueued through `enqueueWrite()` promise chain to prevent race conditions
- Prevents concurrent `chrome.storage.local.set()` calls from overwriting each other

### Tab Management
- All opened tabs tracked in `TabManager` instance owned by `StartRun`; passed into orchestrators via constructor
- **Rewards tab**: Opened by `start-run.ts` before orchestrator chain, untracked (not in `openedTabIds`) so it's not closed by `closeAll()`; manually closed by `_endRun` after run finishes
- **Search/activity tabs**: Opened by orchestrators via `clickCardAndCaptureTab()`, tracked, closed individually after completion or by `closeAll()`
- **Closing behavior**: `closeAll()` closes all tracked tabs with staggered random delays (300–1200 ms between each) to avoid bot-detection patterns

### Message Passing

All cross-context communication via `chrome.runtime.sendMessage()`. See **All Message Constants** section for complete table.

Key flows:
- **Popup ↔ Background**: `START`, `STOP`, `GET_RUN_STATE`, `GET_PREFERENCES`, `SET_PREFERENCE`, `PING`, `PURGE`, `USER_ACTION_COMPLETE`, `RESET_STALE`
- **Background → Popup (broadcasts)**: `PROGRESS` (per-phase state), `DEBUG_ENTRY`, `FAILURE_ENTRY`, `LINGER_WAITING`
- **Background ↔ Rewards content**: `START_EXTRACT`, `ACTIVITIES_FOUND`, `CLICK_CARD`, `VALIDATE_ACTIVITY`, `GET_COUNTERS`
- **Background → Search content**: `PERFORM_SEARCH`, `SCROLL_PAGE`, `CLICK_RESULT`

### Timing Strategy

**Distribution algorithm**: 80% triangular (human-like, middle-biased), 15% quick burst, 5% distracted pause. All implemented in `randMs()` and applied at call time.

**Speed multiplier**: Loaded from preferences at run start. Applied to `randMs()` calls (scaled delays) but NOT to `rawRandMs()` calls (fixed delays). Example:
- `LINGER_ON_PAGE` at 1.0×: 6–10s
- `LINGER_ON_PAGE` at 0.6× (Fast): 3.6–6s
- `LINGER_ON_PAGE` at 8.0× (Stealth): 48–80s
- `LINGER_ON_SEARCH` always 3–6s (never scaled, via `rawRandMs()`)

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
