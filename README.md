# Points Harvest

Earn Bing Rewards on autopilot. Points Harvest is a free, open-source Chrome extension that automatically completes your daily Bing Rewards searches, Explore activities, Daily Set tiles, and More Activities tiles — minimal interaction required.

Following Microsoft's 2026 Rewards overhaul, Gold-tier users in the United States can potentially earn around **3,000 points per month** (~$36/year) through the extension alone. [See the full breakdown.](https://pointsharvest.com/blog/maximum-rewards-points/)

Not affiliated with or endorsed by Microsoft. Automating Microsoft Rewards is against the [Microsoft Rewards Terms of Service](https://www.microsoft.com/en-us/servicesagreement/) — the extension warns you about this on first launch. Use it at your own discretion.

## The 2026 overhaul

Microsoft rebuilt Rewards in 2026 and the new dashboard [reached the United States in mid-July 2026](https://pointsharvest.com/blog/rewards-2026-overhaul/). If you're comparing against an older guide, these are the changes that matter:

- **Level 1 / Level 2 are gone**, replaced by lifetime **Member / Silver / Gold** tiers. Tier status is permanent once earned.
- **Daily search points are capped by tier** — roughly 15 (Member) / 30 (Silver) / 60 (Gold) per day, down from 150/day at Level 2.
- **PC and mobile share one cap.** Searching on your phone no longer opens a second bucket.
- **Daily Set tiles pay 5 points each** (15/day for the set), down from 10.
- **A new STAR Bonus** pays up to 2,100 points/month, awarded by an opaque algorithm that judges whether your search behavior looks natural. By Microsoft's own figures ~80% of users receive under 300, and Microsoft states that bot-like search patterns reset STAR progress — so treat yours as at risk rather than as guaranteed income.

Points Harvest reads your live counters off the rewards dashboard rather than assuming a fixed cap, so it stops at whatever your tier actually allows. It can't manufacture points that no longer exist: a daily run under the new system earns meaningfully less than it did before the rollout, because the program pays less.

## What it does

- **Explore on Bing** — Detects and completes all your "Search on Bing" activity cards, mapping each to the right query automatically
- **Daily Set tiles** — Opens daily set activities and handles simple ones automatically; surfaces quizzes and polls so you can complete them
- **More Activities** — Completes additional activity tiles automatically — opens each tile's search page, dwells, and validates; skips puzzles, quizzes, and install prompts
- **PC Search farming** — After activities are done, farms remaining searches until the daily cap is reached. The cap depends on your Rewards tier (Member/Silver/Gold) and is now shared across PC and mobile; the extension reads your live counter off the dashboard rather than assuming a fixed number, so it stops instead of burning searches that earn nothing
- **Auto-claim** — At the end of each run, claims any pending points from the rewards page's "Ready to claim" flyout, so earned points don't sit unclaimed and expire
- **Hands-on when it matters** — Quizzes, polls, and puzzles are surfaced for you to complete manually; the extension handles everything else

Delays between actions are drawn from a long-tailed human distribution rather than a fixed interval, so runs don't fall into the mechanical, evenly-spaced pattern that trips Bing's search throttle (and that the STAR Bonus algorithm penalizes). A **Stealth** speed setting stretches everything out further. When the run finishes, a summary card shows the duration, points earned per phase, and activity counts.

## Installation

1. Download the latest `PointsHarvest-*.zip` from the [Releases page](../../releases)
2. Extract the ZIP file
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer mode** (toggle in the top right)
5. Click **Load unpacked** and select the extracted folder

You must be signed into your Microsoft account in Chrome for rewards to accrue.

Want to build from source? See the [Developer Guide](DEVELOP.md).

## Usage

Click the extension icon to open the side panel, then click **Run today's searches**.

- The side panel shows real-time progress with per-phase progress bars (Warm-up, Explore, Daily Sets, More Activities, PC Searches, Claim points), and earned points count up as each phase credits them
- A pulsing ⏳ badge appears next to the status line whenever the extension is deliberately pausing between actions; hover it for a live countdown
- When the run finishes, it shows "Done for today!" and a summary card with the duration, points earned per phase, and activity counts
- Runs are safe to repeat. The extension reads what Bing has already credited at the start of every run and skips it, so if a run is interrupted you can simply start another one — it will pick up only what's still outstanding
- While a run is going, Chrome displays a **"PointsHarvest started debugging this browser"** banner. This is expected: clicking activity tiles on Bing's redesigned dashboard only counts if the click is a real browser input event, which requires that permission. The banner disappears when the run ends

## Settings

Open the extension side panel to access these settings:

- **Speed** — Normal (default), Fast, Slow, or Stealth. Scales how long the extension lingers between actions.
- **Skip warm-up searches** — Jump straight to Explore cards instead of running warm-up queries first
- **Disable notifications** — Suppress the desktop notification when a run completes
- **Debug mode** — Show a detailed event log and activity breakdown in the popup (useful for troubleshooting)
- **Purge all state** — Clear all stored data (progress, last run date, search queue, preferences) and reset to a fresh state

## Tips

- If you notice missed points, try the **Slow** or **Stealth** speed setting to give Bing more time to credit each search
- Quizzes, polls, and puzzles are surfaced for you automatically — complete them in the Bing tab, then click **Done** in the popup (or just close the tab) to continue
- If Chrome's popup blocker prevents an activity tab from opening, the extension pauses and shows exact fix instructions — allow pop-ups for `rewards.bing.com` in Chrome settings, then click **Done** to continue
- Run it every day. Under the new system the streak bonus (~210 points per 14 days) and STAR Bonus both reward consistency, so a short daily session is worth more than an occasional long one
- The extension only runs when you manually trigger it — there is no auto-schedule
- If you aren't signed into Bing Rewards, the extension pauses and prompts you to sign in rather than failing outright — sign in, then click **Done** to continue. It only aborts if you're still signed out afterwards
- Leave the Bing Rewards tab alone while a run is in progress. Opening Chrome DevTools on it will stop activity tiles from being credited

## Links

- [Website](https://pointsharvest.com) — full feature overview, FAQ, and blog
- [The 2026 Rewards overhaul explained](https://pointsharvest.com/blog/rewards-2026-overhaul/) — tiers, caps, and the STAR Bonus
- [Points per day in 2026](https://pointsharvest.com/blog/points-per-day/) — daily and monthly totals by tier
- [Developer Guide](DEVELOP.md) — build from source, architecture, and contributing
- [Rewards Dashboard](https://rewards.bing.com/) — where points and activities are tracked
- [Redeem Rewards](https://rewards.bing.com/redeem) — spend your points
- [Contact](https://pointsharvest.com/contact.html) — bug reports, feature requests, and feedback
