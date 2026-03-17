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
2. Extracts available "Search on Bing" activity cards (skipping locked or already-completed ones; treats in-progress cards as actionable)
3. Maps each card to a search query by stripping the "Search on Bing to/for…" boilerplate from the description; falls back to the card title if the description is too short
4. Clicks each card on the rewards page, which opens a Bing search tab, then performs the mapped query in that tab with randomized timing (1–3s dwell before search, 3–5s after, 1.8–5s between searches)
5. Closes each search tab when done
6. Opens each daily set activity in a background tab; for quizzes, polls, tests, and puzzles it activates the tab and waits for you to complete them manually (click **Done** when finished); for other activity types it dwells briefly and closes automatically
7. Closes the rewards tab after all cards and daily sets are processed

## Installation

### Option 1: From Release (recommended)

1. Download the latest `BingBotV2-*.zip` from the [Releases page](../../releases)
2. Extract the ZIP file
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer mode** (toggle in the top right)
5. Click **Load unpacked** and select the extracted folder

### Option 2: From Source

1. Clone or download this repo
2. Run `npm install` then `npm run build`
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer mode** (toggle in the top right)
5. Click **Load unpacked** and select the repo root folder

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
package.json          npm scripts and dev dependencies
tsconfig.json         TypeScript config (full — used by IDE and type checking)
tsconfig.build.json   TypeScript config for emit — excludes content scripts (bundled by esbuild)
src/                  Source files (edit these)
  popup.html          Extension popup UI
  popup.ts            Popup logic
  background.ts       Service worker — tab event listeners, message routing
  orchestrators/
    start-run.ts           Top-level run coordinator (fire-and-forget from background)
    stop-run.ts            Cancels an active run and closes all opened tabs
    complete-explore-on-bing.ts  Iterates mapped cards, clicks each, runs searches
    complete-daily-sets.ts       Opens each daily set tile; lingers for interactive ones
    farm-pc-searches.ts          Farms remaining PC search points after cards are done
  steps/
    fetch-activities.ts    Open rewards tab, wait for content script, extract cards
    fetch-counters.ts      Poll breakdown tab for search point counters
    perform-search.ts      Dwell and execute a single search in a tab
    linger-on-tab.ts       Pause automation and wait for user to complete a tile
    validate-activity.ts   Confirm an activity is marked complete on the rewards page
  util/
    config.ts         Static data: search pools, URL/count constants
    context.ts        createContext() — bundles session/setState/dbg for orchestrators
    debug.ts          Logging helpers and debug type definitions
    state.ts          In-memory session + chrome.storage.local persistent state
    tabs.ts           Tab utilities (waitForTabLoad, closeRewardsTab)
    timing.ts         randMs, sleep, lingerOnPage
  content/
    rewards-content.ts  Content script injected into rewards.bing.com
    search-content.ts   Content script injected into www.bing.com
dist/                 Compiled output — loaded by Chrome at runtime
```

### Flow

```
[User clicks Start]
       │
       ▼
orchestrators/start-run.js loads state, resets session,
fires _executeRun (fire-and-forget)
       │
       ▼
Open rewards.bing.com + breakdown tab in parallel
rewards-content.js polls the SPA until cards render (max 15s),
extracts "Search on Bing" activities + daily set activities,
sends them to background
       │
       ▼
steps/fetch-activities.js maps each activity description → search query
by stripping "Search on Bing to/for..." boilerplate
(falls back to card title if description is too short)
       │
       ▼
orchestrators/complete-explore-on-bing.js —
For each activity card:
  send clickCard → content script clicks the card
  → new Bing search tab opens → wait for tab to load
  → pre-search dwell 1–3s → perform query → post-search dwell 3–5s
  → close tab → delay 1.8–5s → next card
       │
       ▼
orchestrators/complete-daily-sets.js —
For each daily set activity:
  open activity URL in background tab → wait for load (15s timeout)
  if title matches quiz/poll/test/puzzle:
    → activate tab → wait for user to complete it → user clicks Done
  else:
    → dwell 1.5–4s → close tab
  → delay 1.5–4s → next activity
       │
       ▼
orchestrators/farm-pc-searches.js —
Poll breakdown tab for PC search counter;
if not at cap, run searches until cap reached or no progress after 3 tries
       │
       ▼
Rewards tab closed; status set to "Done for today!"
Progress updates sent to popup in real time throughout
```

### Query generation

The content script extracts the card's title and description from the DOM. `buildSearchList()` in `util/activity.ts` maps each activity to a search query by stripping common "Search on Bing to/for…" prefixes from the description. If the remaining text is under 8 characters, the card title is used instead. The result is truncated to 80 characters.

If both the description and title produce nothing usable, the activity is skipped — visible in debug mode as a warning.

## Debug mode

Enable the **Debug mode** checkbox in the popup to reveal a panel with four sections:

**Explore on Bing** — stats from the rewards page scan (total cards, actionable, locked, completed) and a card-by-card breakdown: what title/description was extracted and what search query was generated. Skipped cards are shown with the reason. Below the cards is the full ordered search queue for the session.

**Daily Sets** — stats (total, actionable, locked, completed) and a card-by-card list of daily set activities. Skipped cards show the reason; actionable cards show the target URL.

**PC Search Farming** — the current and max search counts from the Bing breakdown page, updated after the farming phase runs.

**Event Log** — a timestamped live log of what the background is doing: when it starts, how many activities it found, each search as it runs, timing delays, and completion. Each entry is labeled with the orchestrator that produced it. Entries are color-coded (green for success, orange for warnings, red for errors).

If the DOM extraction finds 0 activities (e.g. the rewards page structure changed), the extension aborts with an error — check the debug panel for details.

The debug panel also includes a **Purge all state** button that clears all stored data (progress, last run date, search queue) and resets the extension to a fresh state.

## Notes

- The extension clicks activity cards on the rewards page to open search tabs — this is how Bing tracks the activity as completed
- All search tabs close automatically after each search
- Daily set activities that require user interaction (quizzes, polls, tests, puzzles) are surfaced to you automatically — the tab activates so you can complete it, then click **Done** in the popup to continue. Closing the tab also resumes the run.
- Uses triangular distribution for randomized timing to appear more human-like
- The extension detects if you're not logged into Bing Rewards and will abort with an error message
- Bing may occasionally not credit a search if the tab closes too fast; the default post-search dwell (3–5s) should be sufficient, but you can increase it in `randMs(3000, 5000)` inside `src/steps/perform-search.ts` if you notice missed points
- After all cards and daily sets are processed, the extension farms any remaining PC search points automatically using queries from the pool in `util/config.ts`
- The extension only runs when you manually trigger it — there is no auto-schedule
- Service worker state is preserved across restarts, allowing mid-run resumption
