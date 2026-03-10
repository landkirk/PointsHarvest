# BingBotV2

A Chrome extension that automates daily Bing Rewards points by running your searches and completing "Explore on Bing" activities automatically.

## Links

- [Rewards Dashboard](https://rewards.bing.com/) — where points and activities are tracked
- [Rewards Redeem](https://rewards.bing.com/redeem) — spend your points
- [Bing Search](https://www.bing.com) — where searches are performed

## What it does

Bing Rewards gives points for completing "Explore on Bing" activities — specific searches like finding insurance plans, translating a word, or looking up movie times.

This extension:
1. Opens your Rewards dashboard in a background tab and waits for activity cards to render
2. Extracts available "Search on Bing" activity cards (skipping locked or already-completed ones)
3. Maps each card to a search query by stripping the "Search on Bing to/for…" boilerplate from the description; falls back to the card title if the description is too short
4. Clicks each card on the rewards page, which opens a Bing search tab, then performs the mapped query in that tab with randomized timing (1–3s dwell before and after search, 1.8–5s between searches)
5. Closes each search tab when done; closes the rewards tab after all cards are clicked

## Installation

### Option 1: From Release (recommended)

1. Download the latest `BingBotV2-*.zip` from the [Releases page](../../releases)
2. Extract the ZIP file
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer mode** (toggle in the top right)
5. Click **Load unpacked** and select the extracted folder

### Option 2: From Source

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select this folder

You must be signed into your Microsoft account in Chrome for rewards to accrue.

## Usage

Click the extension icon → **Run today's searches**.

The extension tracks the last run date and progress:
- If you run it today and complete all searches, it shows "Done for today!" and won't run again until tomorrow
- If interrupted mid-run, it resumes from where it left off (same day only)
- Each new day, the date check resets and you can run it again
- The popup shows real-time progress with a status indicator, progress bar, and the current search being performed

## How it works

### File structure

```
manifest.json         Extension config (MV3)
src/
  popup.html          Extension popup UI
  background.js       Service worker — entry point, listeners, main flow
  state.js            Shared in-memory state and closeRewardsTab helper
  popup.js            Popup logic
  steps/
    fetch-activities.js  Open rewards tab, extract cards, map to queries
    run-searches.js      Click each card and run the search loop
    perform-search.js    Dwell and execute a single search in a tab
  util/
    config.js         Static data: search pools, URL/count constants
    debug.js          Logging and timing helpers
  content/
    rewards-content.js  Content script injected into rewards.bing.com
    search-content.js   Content script injected into www.bing.com
```

### Flow

```
[User clicks Start]
       │
       ▼
Open rewards.bing.com (background tab)
       │
       ▼
src/content/rewards-content.js polls the SPA until cards render (max 15s),
extracts available "Search on Bing" activities, sends them to background
       │
       ▼
background.js maps each activity description → search query
by stripping "Search on Bing to/for..." boilerplate
(falls back to card title if description is too short)
       │
       ▼
For each activity card:
  background sends clickCard → content script clicks the card
  → new Bing search tab opens → wait for tab to load
  → pre-search dwell 1–3s → perform query → post-search dwell 1–3s
  → close tab → delay 1.8–5s → next card
       │
       ▼
Rewards tab closed after all cards are clicked
       │
       ▼
Progress updates sent to popup in real time
```

### Query generation

The content script extracts the card's title and description from the DOM. The background generates a search query by stripping common "Search on Bing to/for…" prefixes from the description. If the remaining text is under 8 characters, the card title is used instead. The result is truncated to 80 characters.

If both the description and title produce nothing usable, the activity is skipped — visible in debug mode as a warning.

## Debug mode

Enable the **Debug mode** checkbox in the popup to reveal a panel with three sections:

**DOM Extraction** — shows stats from the rewards page scan (total cards, actionable cards found, locked cards skipped) and a card-by-card breakdown: what title/description was extracted and what search query was generated. Skipped cards are shown with the reason.

**Search Queue** — the full ordered list of queries that will be (or were) run for this session.

**Event Log** — a timestamped live log of what the background is doing: when it starts, how many activities it found, each search as it runs, timing delays, and completion. Entries are color-coded (green for success, orange for warnings, red for errors).

If the DOM extraction finds 0 activities (e.g. the rewards page structure changed), the extension aborts with an error — check the debug panel for details.

The debug panel also includes a **Purge all state** button that clears all stored data (progress, last run date, search queue) and resets the extension to a fresh state.

## Notes

- The extension clicks activity cards on the rewards page to open search tabs — this is how Bing tracks the activity as completed
- All search tabs close automatically after each search
- Uses triangular distribution for randomized timing to appear more human-like
- The extension detects if you're not logged into Bing Rewards and will abort with an error message
- Bing may occasionally not credit a search if the tab closes too fast; the default dwell range (1–3s) should be sufficient, but you can increase it in `randMs(1000, 3000)` inside `performSearchInTab` in `src/steps/perform-search.js` if you notice missed points
- The extension only runs when you manually trigger it — there is no auto-schedule
- Service worker state is preserved across restarts, allowing mid-run resumption
