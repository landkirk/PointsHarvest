# Points Harvest

A Chrome extension that automates daily Bing Rewards points by running your searches and completing "Explore on Bing", "Daily Sets", and "More Activities" cards automatically.

## Links

- [Rewards Dashboard](https://rewards.bing.com/) — where points and activities are tracked
- [Rewards Redeem](https://rewards.bing.com/redeem) — spend your points
- [Bing Search](https://www.bing.com) — where searches are performed

## What it does

Bing Rewards gives points for completing "Explore on Bing" activities — specific searches like finding insurance plans, translating a word, or looking up movie times.

This extension:
1. Opens your Rewards dashboard in a background tab, scrolls to ensure all cards render, and extracts activity cards
2. Extracts available "Search on Bing" activity cards (skipping locked or already-completed ones; treats in-progress cards as actionable)
3. Maps each card to a search query by stripping the "Search on Bing to/for…" boilerplate from the description; falls back to the card title if the description is too short
4. _(Optional)_ Runs warm-up searches (3 pre-computed queries) to establish a browsing pattern before starting the main activities
5. Clicks each Explore card on the rewards page, which opens a Bing search tab, then performs the mapped query with randomized timing and realistic user behavior:
   - Character-by-character typing with realistic pause patterns (40–120 ms per character, occasional 200–400 ms hesitation pauses)
   - Scrolling the results page during the dwell time (2–3 scroll events, 300–900 px total, at random points in the dwell window)
   - ~35% chance of clicking an organic search result (simulating natural click-through behavior)
   - Staggered page dwells (6–10s per page) affected by your speed preference
6. Closes each search tab when done
7. Clicks each daily set activity card on the rewards page (the same way Explore cards are clicked, so Bing can track completion); for quizzes, polls, tests, and puzzles it activates the opened tab and waits for you to complete them manually (click **Done** when finished); for other activity types it dwells briefly and closes automatically
8. Completes "More Activities" tiles — opens each tile's pre-built search URL, dwells 6–10s, closes, and validates; tiles containing skip keywords (puzzle, quiz, browser extension, set Bing, install, play) are skipped automatically
9. Farms remaining PC search points automatically using additional queries from a rotation pool
10. Closes all tabs with staggered timing to appear more human-like
11. Shows a run summary card with the run duration, points earned per phase, and activity counts

## Installation

### Option 1: From Release (recommended)

1. Download the latest `RewardFarm-*.zip` from the [Releases page](../../releases)
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

Click the extension icon to open the side panel → **Run today's searches**.

The extension tracks the last run date and progress:
- If you run it today and complete all searches, it shows "Done for today!" and won't run again until tomorrow
- If interrupted mid-run, it resumes from where it left off (same day only)
- Each new day, the date check resets and you can run it again
- The popup shows real-time progress with per-phase progress bars (Warm-up, Explore, Daily Sets, More Activities, PC Search); earned points count up as each phase credits them
- When the run ends, the popup shows a summary card with duration, points earned per phase, and activity counts

## How it works

### File structure

```
manifest.json         Extension config (MV3)
package.json          npm scripts and dev dependencies
tsconfig.json         TypeScript config (full — used by IDE and type checking)
tsconfig.build.json   TypeScript config for emit — excludes content scripts (bundled by esbuild)
src/                  Source files (edit these)
  background.ts       Service worker — tab event listeners, message routing
  ui/
    popup.html        Extension side panel UI
    popup.ts          Popup logic and phase progress rendering
    onboarding.html   First-run onboarding UI
    onboarding.ts     Onboarding flow logic
    debug-panel.ts    Debug log and activity/counter rendering
    failure-banner.ts Soft failure display and management
    prefs-panel.ts    User preferences panel (Speed, Notifications, Debug Mode)
    screens/          HTML fragments shown in onboarding (ToS, Bing warning, changelog)
  managers/
    start-run.ts           Top-level run coordinator (fire-and-forget from background)
    stop-run.ts            Cancels an active run and closes all opened tabs
  orchestrators/
    activity-extraction.ts       Opens rewards tab, extracts and classifies activity cards
    complete-explore-on-bing.ts  Iterates mapped cards, clicks each, runs searches
    complete-daily-sets.ts       Opens each daily set tile; lingers for interactive ones
    complete-more-activities.ts  Opens More Activities tiles, dwells, and validates; skips interactive tile types
    farm-pc-searches.ts          Farms remaining PC search points after cards are done
    warm-up-searches.ts          Runs warm-up searches before the main Explore phase
  steps/
    fetch-counters.ts      Poll breakdown tab for search point counters
    perform-search.ts      Dwell and execute a single search in a tab
    linger-on-tab.ts       Pause automation and wait for user to complete a tile
    validate-activity.ts   Confirm an activity is marked complete on the rewards page
  util/
    activity-runner.ts ActivityRunner class — executes activities with retry logic
    activity.ts        Activity type, CardState enum, classifyCard(), enrichSearchQueries()
    config.ts          URL constants (REWARDS_URL, REWARDS_BREAKDOWN_URL)
    context.ts         createContext() — bundles setState/dbg/updateHeader for orchestrators
    debug.ts           Logging helpers (dbg()) and DebugEntry type
    failures.ts        FailureEntry type, fail() helper, FAIL category const
    messaging.ts       MSG_ACTION constants and AppMessage union type
    persistent-state.ts chrome.storage.local for run state + user preferences, PHASE constants, write queue
    runtime-state.ts   In-memory runtime state (activeOrchestrator) — resets on SW restart
    search-queries.ts  PC_SEARCH_QUERIES and WARMUP_SEARCH_QUERIES pools
    tab-manager.ts     TabManager class — open/close/focus/capture tabs, staggered closing
    timing.ts          randMs, sleep, lingerOnPage, TIMING presets, speed multiplier system
  interfaces/
    orchestrator.ts   OrchestratorBase abstract class
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
managers/start-run.ts loads state, resets session,
opens rewards.bing.com tab, fires _executeRun (fire-and-forget)
       │
       ▼
orchestrators/activity-extraction.ts —
rewards-content.ts scrolls page twice to ensure all cards render,
extracts and classifies activity cards (explore, daily set, ignored),
enriches each with search queries or user-action metadata
       │
       ▼
orchestrators/warm-up-searches.ts (unless skipped) —
runs 3 warm-up Bing searches with randomized queries
       │
       ▼
orchestrators/complete-explore-on-bing.ts —
For each activity card:
  send clickCard → content script clicks the card with pointer events
  → new Bing search tab opens → wait for tab to load
  → dwell on search tab 3–6s (not affected by speed setting)
  → send performSearch → type query character-by-character with pauses
  → dwell on results 6–10s → schedule 2–3 scroll events during dwell
  → 35% chance of clicking an organic result → extra dwell 2–6s
  → close tab with staggered delay
  → validate activity marked complete
  → linger 6–10s → next card
       │
       ▼
orchestrators/complete-daily-sets.ts —
For each daily set activity:
  send clickCard → content script clicks the card
  → new activity tab opens → wait for tab to load
  if title matches quiz/poll/test/puzzle:
    → activate tab → wait for user to complete it → user clicks Done
  else:
    → dwell 6–10s → close tab
  → validate activity marked complete
  → linger 6–10s → next activity
       │
       ▼
orchestrators/complete-more-activities.ts —
For each More Activities tile (skipping puzzle/quiz/browser extension/set bing/install/play):
  send clickCard → content script clicks the tile
  → pre-built Bing search URL opens in new tab → wait for tab to load
  → dwell 6–10s → close tab
  → validate activity marked complete
  → linger 6–10s → next tile
       │
       ▼
orchestrators/farm-pc-searches.ts —
Poll breakdown tab for PC search counter;
if not at cap, run searches with rotation queries until cap reached or no progress after 3 tries
       │
       ▼
Close all tabs with staggered delays (300–1200 ms between each);
status set to "Done for today!" with notification
Per-phase progress (Warm-up, Explore, Daily Sets, More Activities, PC Search) and point totals
sent to popup in real time throughout
```

### Query generation

The content script extracts the card's title and description from the DOM. `buildSearchList()` in `util/activity.ts` maps each activity to a search query by stripping common "Search on Bing to/for…" prefixes from the description. If the remaining text is under 8 characters, the card title is used instead. The result is truncated to 80 characters.

If both the description and title produce nothing usable, the activity is skipped — visible in debug mode as a warning.

## Debug mode and settings

Enable the **Debug mode** checkbox in the popup to reveal a panel with four sections:

**Explore on Bing** — stats from the rewards page scan (total cards, actionable, locked, completed) and a card-by-card breakdown: what title/description was extracted and what search query was generated. Skipped cards are shown with the reason. Below the cards is the full ordered search queue for the session.

**Daily Sets** — stats (total, actionable, locked, completed) and a card-by-card list of daily set activities. Skipped cards show the reason; actionable cards show the target URL.

**PC Search Farming** — the current and max search counts from the Bing breakdown page, updated after the farming phase runs.

**Event Log** — a timestamped live log of what the background is doing: when it starts, how many activities it found, each search as it runs, timing delays, and completion. Each entry is labeled with the orchestrator/step that produced it. Entries are color-coded (green for success, orange for warnings, red for errors). Soft failures appear as a separate banner above the log.

The popup also includes:
- **Speed** setting — choose Normal (1.0×), Fast (0.6×), Slow (4.0×), or Stealth (8.0×) to scale all timing delays. The "dwell before search" timing is not affected by this setting.
- **Disable notifications** checkbox — suppresses desktop notifications when the run completes
- **Skip warm-up searches** checkbox — skip the initial warm-up phase and jump straight to Explore cards
- **Purge all state** button — clears all stored data (progress, last run date, search queue, preferences) and resets the extension to a fresh state

If the DOM extraction finds 0 activities (e.g. the rewards page structure changed), the extension aborts with an error — check the debug panel for details.

## Notes

- **Human-like behavior**: The extension types queries character-by-character (40–120 ms per char with occasional hesitation pauses), scrolls search results pages, and clicks organic search results ~35% of the time — all to avoid bot-detection patterns.
- **Timing distribution**: All delays use a long-tail human distribution: 80% triangular (middle of range), 15% quick bursts (30–70% of min), 5% distracted pauses (100–200% of max). Your speed preference scales these, except the pre-search dwell (3–6s) which always stays consistent.
- **Speed preference**: Set via the popup settings. Normal (1.0×) is default. Fast (0.6×), Slow (4.0×), and Stealth (8.0×) scale all timing except the pre-search dwell.
- The extension clicks activity cards on the rewards page to open search tabs — this is how Bing tracks the activity as completed.
- All search tabs close automatically after each search with staggered delays (300–1200 ms between closes) to appear more natural.
- Daily set activities that require user interaction (quizzes, polls, tests, puzzles) are surfaced to you automatically — the tab activates so you can complete it, then click **Done** in the popup to continue. Closing the tab also resumes the run. The popup header names the specific activity (e.g. `Complete the quiz "..." in the Bing tab, then click Done.`) so you know exactly what to do.
- The popup header includes a link to the Bing Rewards Dashboard for quick manual access.
- The extension detects if you're not logged into Bing Rewards and will abort with an error message.
- Bing may occasionally not credit a search if the tab closes too fast; the default post-search dwell (6–10s) should be sufficient. If you notice missed points, increase your Speed setting to Slow (4.0×) or Stealth (8.0×).
- After all cards and daily sets are processed, the extension farms any remaining PC search points automatically using a rotation of queries from the pool.
- All activity and search tabs open in the same browser window as the extension side panel.
- If Chrome's popup blocker prevents an activity tab from opening, the extension pauses and shows exact fix instructions; allow pop-ups for `rewards.bing.com` in Chrome settings, then click **Done** to continue. The failure banner clears automatically once the issue is fixed.
- The extension only runs when you manually trigger it — there is no auto-schedule.
- Service worker state is preserved across restarts, allowing mid-run resumption.
