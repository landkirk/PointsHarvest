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
    fetch-activities.js  Open rewards tab, extract cards, map to queries
    run-searches.js      Click each card and run the search loop
    perform-search.js    Dwell and execute a single search in a tab
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
- Manages search queue building and execution
- Handles activity mapping and fallback query generation
- Tracks state in chrome.storage.local
- Implements randomized timing (triangular distribution)

### src/content/rewards-content.js
- Injected into rewards.bing.com
- Polls the SPA until activity cards render (max 15s)
- Extracts available activities (skips locked/completed)
- Detects login status
- Sends extracted data back to background script

### popup.js
- Real-time UI updates via chrome.runtime.onMessage
- Debug panel with DOM extraction, search queue, and event log
- State management (start/stop/purge)

### util/config.js
- General search pool (25 queries)
- Search count range (12-17 per run)
- URLs and constants

## Making Changes

### Adjusting Timing

All timing uses `randMs(min, max)` with triangular distribution:

- **Initial delay**: `randMs(0, 8000)` — delay before first search
- **Dwell time**: `randMs(1800, 4500)` — time spent on each search page
- **Between searches**: `randMs(1800, 5000)` — delay between searches

Edit these values in `background.js` → `startRun()` and `performSearch()`.

### Changing Search Count

Edit `config.js`:

```javascript
export const MIN_SEARCHES = 12;
export const MAX_SEARCHES = 17;
```

The extension picks a random target between these values each run.

### Modifying DOM Extraction

Edit `src/content/rewards-content.js`:

- `MAX_WAIT_MS` — how long to wait for page load (default: 15s)
- `POLL_INTERVAL_MS` — how often to check for content (default: 500ms)
- `AVAILABLE_STATUSES` — text patterns that indicate an actionable activity
- `LOCKED_KEYWORDS` — text patterns that indicate a locked activity

## Testing

### Manual Testing
1. Make your changes
2. Reload the extension in `chrome://extensions`
3. Open the extension popup
4. Enable **Debug mode** to see detailed logs
5. Click **Run today's searches**
6. Monitor the debug panel for extraction results, search queue, and event log

### Testing Without Running Searches
To test activity extraction without running searches, add a return statement in `background.js` → `startRun()` after the activity mapping step:

```javascript
await chrome.storage.local.set({ mappedActivities: mapped, searchQueue: searches });
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
- Increase dwell time in `performSearch()`: `randMs(2500, 6000)`
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
- Tabs closed automatically after search completes
- Rewards dashboard tab closed after extraction
- Stop button closes all extension-opened tabs

### Message Passing
- `popup.js` ↔ `background.js`: bidirectional via `chrome.runtime.sendMessage`
- `src/content/rewards-content.js` → `background.js`: one-way via `chrome.runtime.sendMessage`
- Real-time progress updates pushed to popup during run

### Randomization Strategy
- Triangular distribution (`randMs`) biases toward middle of range — more human-like
- Search queue shuffled each run for variety
- Random query variant selected from each keyword pool
- Random target count (12-17) varies total searches per run

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
