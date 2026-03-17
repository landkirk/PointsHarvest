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
src/                    Source files (edit these)
  popup.html            Extension popup UI (copied to dist/ verbatim)
  popup.ts              Popup logic and state management
  background.ts         Service worker — tab event listeners, message routing
  orchestrators/
    start-run.ts            Top-level run coordinator (fire-and-forget from background)
    stop-run.ts             Cancels active run, invokes pending resolvers, closes tabs
    complete-explore-on-bing.ts  Iterates mapped cards, clicks each, runs searches
    complete-daily-sets.ts       Opens each daily set tile; lingers for interactive ones
    farm-pc-searches.ts          Farms remaining PC search points after cards are done
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
    messaging.ts        MSG_ACTION constants and MsgAction type
    search-queries.ts   PC_SEARCH_QUERIES pool used by farm-pc-searches
    state.ts            chrome.storage.local persistent state + runtime state (activeOrchestrator, isActivelyRunning)
    tabs.ts             Tab utilities (openTab, waitForTabLoad, closeOwnedTabs)
    timing.ts           randMs, sleep, lingerOnPage, TIMING presets
  interfaces/
    orchestrator.ts     OrchestratorBase abstract class
  content/
    rewards-content.ts  Content script injected into rewards.bing.com (bundled by esbuild)
    search-content.ts   Content script injected into www.bing.com (bundled by esbuild)
dist/                   Compiled output (generated — do not edit)
.github/workflows/      GitHub Actions for automated releases
```

## Key Components

### background.ts
- Tab event listeners only: load detection, tab capture, tab removal
- Message routing: `START` / `STOP` / `GET_STATE` / `PING` / `PURGE` / `USER_ACTION_COMPLETE`
- Delegates all run logic to `orchestrators/start-run.ts` and `orchestrators/stop-run.ts`

### orchestrators/start-run.ts
- Loads state, resets session/log/storage, creates a context object
- Fires `_executeRun` as fire-and-forget (returns immediately so background can ack the message)
- `_executeRun` opens rewards dashboard + breakdown tab in parallel, then chains the three sub-orchestrators via `_runOrchestrator`, which sets/clears `activeOrchestrator` in `state.ts` around each run

### orchestrators/stop-run.ts
- Calls `setIsActivelyRunning(false)` and persists stopped status
- Invokes any pending resolver functions (unblocking awaiting code), then calls `resetSession()`
- Removes all tabs tracked in `openedTabIds`

### orchestrators/complete-explore-on-bing.ts
- Iterates the mapped activity list from a given `startIndex`
- Sends `clickCard` to content script, captures the new tab, waits for load
- Calls `steps/perform-search`, validates the activity, sends progress updates to popup

### orchestrators/complete-daily-sets.ts
- Iterates daily set activities extracted from the rewards page
- Opens each activity URL in a tab; waits up to 15s for load
- If the activity title matches `quiz|poll|test|puzzle`, calls `steps/linger-on-tab` to pause for user interaction; otherwise dwells and closes
- Calls `steps/validate-activity` after each activity

### orchestrators/farm-pc-searches.ts
- Opens a breakdown tab if one isn't already open, then polls for the PC Search counter
- Runs Bing searches in a loop until the cap is reached or no progress after `MAX_NO_PROGRESS` (3) consecutive searches
- Throws on no-progress so callers can catch and log without aborting the whole run

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
- `setState` / `loadState` / `resetState` — write-through cache backed by `chrome.storage.local`
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

### popup.ts
- Real-time UI updates via `chrome.runtime.onMessage`
- Debug panel with per-orchestrator sections: Explore on Bing (DOM stats + cards + search queue), Daily Sets (stats + cards), PC Search Farming (counters), and Event Log
- Start / Stop / Purge actions

### content/rewards-content.ts
- Bundled by esbuild — can freely import from `util/`
- Polls the rewards SPA until activity cards render (max 15s), extracts "Search on Bing" activities and daily set activities, sends them to background
- Handles `CLICK_CARD`, `VALIDATE_ACTIVITY`, and `GET_COUNTERS` messages on demand

### content/search-content.ts
- Bundled by esbuild — can freely import from `util/`
- Handles a single `PERFORM_SEARCH` message: fills the Bing search box and submits the form

## Making Changes

### Adjusting Timing

All timing uses `randMs(min, max)` with triangular distribution (defined in `util/timing.ts`). Named presets live in `TIMING` in `util/timing.ts`:

- **Page dwell**: `TIMING.LINGER_ON_PAGE` (`5–7s`) used by `lingerOnPage()` everywhere — before searches, after searches, between searches, on tile pages, after PC searches
- `TIMING.INITIAL_DELAY` (`0–8s`) is defined but currently unused

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

## Creating a Release

### Automatic Release (Recommended)

1. Update version in `manifest.json`
2. Run `npm run build` to produce a fresh `dist/`
3. Commit your changes:
   ```bash
   git add .
   git commit -m "Release v1.0.1"
   ```
3. Create and push a tag:
   ```bash
   git tag v1.0.1
   git push origin main
   git push origin v1.0.1
   ```
4. GitHub Actions will automatically:
   - Create a ZIP file
   - Create a GitHub Release
   - Attach the ZIP to the release

### Manual Release

1. Go to the **Actions** tab in GitHub
2. Select **Build Release** workflow
3. Click **Run workflow**
4. Download the ZIP from the artifacts section

The workflow excludes `.git`, `.github`, and `.DS_Store` files from the ZIP.

## Debugging Tips

### Service Worker Console
1. Go to `chrome://extensions`
2. Find BingBotV2
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
- Persistent state stored in `chrome.storage.local`
- Runtime state (`isActivelyRunning`, `activeOrchestrator`) lives in `util/state.ts` and resets on service worker restart
- `lastRunDate` comparison enables daily reset without manual clearing

### Tab Management
- All opened tabs tracked in `openedTabIds` Set
- The rewards tab stays open throughout the run so cards can be clicked on demand; closed after all cards are done
- Search tabs close automatically after each search completes
- Stop button closes all extension-opened tabs

### Message Passing
- `popup.ts` ↔ `background.ts`: bidirectional via `chrome.runtime.sendMessage`
- `background.ts` ↔ `rewards-content.ts`: bidirectional (`START_EXTRACT`, `CLICK_CARD`, `VALIDATE_ACTIVITY` commands; `ACTIVITIES_FOUND` response)
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
