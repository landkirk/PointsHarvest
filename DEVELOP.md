# Developer Guide

## Development Setup

1. Clone the repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked** and select the project folder
5. Make your changes to the code
6. Click the refresh icon on the extension card to reload changes

## Project Structure

```
manifest.json         Extension config (Manifest V3)
src/
  popup.html          Extension popup UI
  background.js       Service worker — entry point, listeners, main flow
  state.js            Shared in-memory state and closeRewardsTab helper
  popup.js            Popup logic and state management
  steps/
    fetch-activities.js    Open rewards tab, extract cards, map to queries
    run-searches.js        Click each card and run the search loop
    perform-search.js      Dwell and execute a single search in a tab
    complete-daily-sets.js Open each daily set tile; linger for interactive ones
    linger-on-tab.js       Pause automation and wait for user to complete a tile
  util/
    config.js         Static data: search pools, constants
    debug.js          Logging and timing helpers
  content/
    rewards-content.js  Content script injected into rewards.bing.com
    search-content.js   Content script injected into www.bing.com
.github/workflows/    GitHub Actions for automated releases
```

## Key Components

### background.js
- Main orchestration logic
- Handles tab event listeners (load detection, tab capture, tab removal)
- Coordinates the fetch → map → run pipeline
- Tracks state in chrome.storage.local
- Implements randomized initial delay (triangular distribution)

### src/steps/fetch-activities.js
- Opens rewards.bing.com in a background tab
- Waits up to 20s for content script to report extracted activities
- Maps each activity → search query via boilerplate stripping (`generateSearchQuery`)

### src/content/rewards-content.js
- Injected into rewards.bing.com
- Polls the SPA until activity cards render (max 15s)
- Extracts "Search on Bing" cards (skips locked/completed; treats in-progress as actionable) and daily set tiles
- Retains card DOM elements for on-demand clicking
- Detects login status
- Handles `startExtract` and `clickCard` messages from background

### src/steps/run-searches.js
- Iterates the mapped activity list
- Sends `clickCard` to content script for each card, captures the new tab
- Waits for tab to load, calls `performSearchInTab`, closes tab
- Sends progress updates to popup

### src/steps/perform-search.js
- Pre-search dwell (1–3s), then sends `performSearch` to search-content.js
- Post-search dwell (3–5s) before returning

### src/steps/complete-daily-sets.js
- Iterates daily set tiles extracted from the rewards page
- Opens each tile's URL in a background tab; waits up to 15s for load
- If the page title matches `quiz|poll|test|puzzle`, calls `lingerOnTab()` to pause for user interaction
- Otherwise dwells 1.5–4s and closes the tab
- Random delay 1.5–4s between tiles

### src/steps/linger-on-tab.js
- Activates the daily set tab so the user can see and complete it
- Sets `state.lingerResolve` so the popup's **Done** button (or tab close) resumes the run

### popup.js
- Real-time UI updates via chrome.runtime.onMessage
- Debug panel with DOM extraction, search queue, and event log
- State management (start/stop/purge)

### util/config.js
- General search pool (25 queries, currently unused in main flow)
- Search count range constants (currently unused in main flow)
- URLs and constants

## Making Changes

### Adjusting Timing

All timing uses `randMs(min, max)` with triangular distribution:

- **Initial delay**: `randMs(0, 8000)` in `background.js` → `startRun()` — delay before first search
- **Pre-search dwell**: `randMs(1000, 3000)` in `steps/perform-search.js` — pause before typing the query
- **Post-search dwell**: `randMs(3000, 5000)` in `steps/perform-search.js` — pause after search navigates
- **Between searches**: `randMs(1800, 5000)` in `steps/run-searches.js` — delay between cards
- **Daily set tile dwell**: `randMs(1500, 4000)` in `steps/complete-daily-sets.js` — pause on non-interactive tiles
- **Between daily set tiles**: `randMs(1500, 4000)` in `steps/complete-daily-sets.js` — delay between tiles

### Modifying DOM Extraction

Edit `src/content/rewards-content.js`:

- `MAX_WAIT_MS` — how long to wait for page load (default: 15s)
- `POLL_INTERVAL_MS` — how often to check for content (default: 500ms)
- `LOCKED_KEYWORDS` — text patterns that indicate a locked activity

### Modifying Query Generation

Edit `src/steps/fetch-activities.js` → `generateSearchQuery`:

- `BOILERPLATE` — regex patterns stripped from activity descriptions
- Minimum useful length threshold (`base.length < 8` falls back to title)
- Max query length (currently truncated to 80 chars)

## Testing

### Manual Testing
1. Make your changes
2. Reload the extension in `chrome://extensions`
3. Open the extension popup
4. Enable **Debug mode** to see detailed logs
5. Click **Run today's searches**
6. Monitor the debug panel for extraction results, search queue, and event log

### Testing Without Running Searches
To test activity extraction without running searches, add a return statement in `background.js` → `startRun()` after the mapping step:

```javascript
await chrome.storage.local.set({ mappedActivities: mapped, searchQueue: mapped.filter(m => m.query).map(m => m.query) });
chrome.runtime.sendMessage({ action: 'debugReady' }).catch(() => {});
return; // Stop here for testing
```

### Resetting State
Use the **Purge all state** button in the debug panel to clear all stored data and reset to a fresh state.

## Creating a Release

### Automatic Release (Recommended)

1. Update version in `manifest.json`
2. Commit your changes:
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
- Bing may have changed their page structure — inspect `src/content/rewards-content.js` extraction logic
- Enable debug mode to see DOM extraction stats

**Searches not credited**
- Increase dwell time in `steps/perform-search.js`: `randMs(2000, 5000)`
- Check if you're logged into the correct Microsoft account
- Bing may have rate limiting — increase delays between searches

**"Not logged in" error**
- Sign into your Microsoft account at bing.com
- Ensure cookies are enabled
- Check if rewards.bing.com redirects you to a login page

## Architecture Notes

### State Management
- Persistent state stored in `chrome.storage.local`
- In-memory state (`isActivelyRunning`, `pendingTabId`, etc.) resets on service worker restart
- `lastRunDate` comparison enables daily reset without manual clearing

### Tab Management
- All opened tabs tracked in `openedTabIds` Set
- The rewards tab stays open throughout the run so cards can be clicked on demand; closed after all cards are done
- Search tabs close automatically after each search completes
- Stop button closes all extension-opened tabs

### Message Passing
- `popup.js` ↔ `background.js`: bidirectional via `chrome.runtime.sendMessage`
- `background.js` ↔ `rewards-content.js`: bidirectional (`startExtract`, `clickCard` commands; `activitiesFound` response)
- `background.js` → `search-content.js`: one-way `performSearch` command
- Real-time progress updates pushed to popup during run

### Randomization Strategy
- Triangular distribution (`randMs`) biases toward middle of range — more human-like
- Random initial delay (0–8s) before the first search each run

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
