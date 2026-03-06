# Bing Rewards Automator

A Chrome extension that automates daily Bing Rewards points by running your searches and completing "Explore on Bing" activities automatically.

## Links

- [Rewards Dashboard](https://rewards.bing.com/) — where points and activities are tracked
- [Rewards Redeem](https://rewards.bing.com/redeem) — spend your points
- [Bing Search](https://www.bing.com) — where searches are performed

## What it does

Bing Rewards gives up to **50 points/day** for PC searches (5 pts each, starting from your 3rd search). It also offers **10–50 pt bonuses** for "Explore on Bing" activities — specific searches like finding insurance plans, translating a word, or looking up movie times.

This extension:
1. Opens your Rewards dashboard and **reads the page** to find which activities are currently available and not yet completed (skipping locked or already-done ones)
2. Maps each activity's description to an appropriate Bing search query using keyword matching
3. Fills remaining slots with general searches to guarantee you hit the **50-pt search cap** (requires 12 searches total)
4. Runs each search in a background tab, waits ~2.5s for the reward to register, then closes the tab and moves on

The whole run takes roughly 2–3 minutes.

## Installation

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select this folder

You must be signed into your Microsoft account in Chrome for rewards to accrue.

## Usage

Click the extension icon → **Run today's searches**.

The extension remembers if you've already run today and won't double-run. If interrupted mid-run, it resumes from where it left off.

## How it works

### File structure

```
manifest.json         Extension config (MV3)
background.js         Service worker — orchestrates the whole flow
rewards-content.js    Content script injected into rewards.bing.com
popup.html            Extension popup UI
popup.js              Popup logic
config.js             Static data: keyword map, search pools, URL/count constants
```

### Flow

```
[User clicks Start]
       │
       ▼
Open rewards.bing.com (background tab)
       │
       ▼
rewards-content.js polls the SPA until cards render,
extracts available activities, sends them to background
       │
       ▼
background.js maps each activity description → search query
using keyword matching (e.g. "book" → "best books to read 2025")
       │
       ▼
Pads with general searches if needed to reach 12 total
       │
       ▼
Opens each search in a background tab → waits for load
→ waits 2.5s → closes tab → waits 2s → next search
       │
       ▼
Progress updates sent to popup in real time
```

### Activity keyword mapping

The content script extracts activity card titles and descriptions from the DOM. The background then matches that text against a keyword table:

| Keywords | Query used |
|---|---|
| weather, forecast | weather forecast this week |
| time, timezone, zone | what time is it in tokyo japan right now |
| translate, translation | translate bonjour from french to english |
| vocabulary, word, meaning | define serendipity meaning vocabulary |
| lyric, song | bohemian rhapsody queen song lyrics |
| movie, film, cinema | best new movies to watch 2025 |
| cruise, sail | best caribbean cruise deals 2025 |
| concert, ticket, show | concert tickets near me 2025 |
| flower, delivery, smile | same day flower delivery near me |
| home, renovation, upgrade | home renovation improvement ideas |
| internet, broadband, provider | best internet service providers 2025 |
| credit card, swipe, rate | best cashback rewards credit cards 2025 |
| car, vehicle, auto, road | used cars for sale near me under 20000 |
| insurance | best home insurance plans comparison 2025 |
| diy, craft, creative, kit | DIY craft kit ideas for adults |
| book, read, novel | best books to read 2025 |
| deal, shop, shopping | best online shopping deals electronics |

Activities whose descriptions don't match any keyword are skipped (visible in debug mode).

## Debug mode

Enable the **Debug mode** checkbox in the popup to reveal a panel with three sections:

**DOM Extraction** — shows stats from the rewards page scan (total elements, action elements found, locked cards skipped) and a card-by-card breakdown: what title/description was extracted, which keyword matched, and what search query was chosen. Cards that were skipped are shown in red with the reason.

**Search Queue** — the full ordered list of queries that will be (or were) run for this session.

**Event Log** — a timestamped live log of what the background is doing: when it starts, how many activities it found, each search as it runs, and completion.

If the DOM extraction finds 0 activities (e.g. the rewards page structure changed), the log will show a warning and the extension will fall back to running general searches only to still hit the points cap.

## Notes

- The extension does not interact with the rewards page beyond reading it — no clicks, no form submissions
- All searches run in background tabs that close automatically
- Bing may occasionally not credit a search if the tab closes too fast; the `LOAD_WAIT_MS` constant in `background.js` (default 2500ms) can be increased if you notice missed points
- The extension only runs when you manually trigger it — there is no auto-schedule
