import { REWARDS_URL, REWARDS_BREAKDOWN_URL, MSG_ACTION } from '../util/config.js';
import { randMs, sleep, TIMING } from '../util/timing.js';
import { resetLog } from '../util/debug.js';
import { resetSession, loadState, resetState } from '../util/state.js';
import { closeRewardsTab, openTab } from '../util/tabs.js';
import { createContext } from '../util/context.js';
import { run as fetchActivities, buildSearchList } from '../steps/fetch-activities.js';

import * as completeExploreOnBing from './complete-explore-on-bing.js';
import * as completeDailySets from './complete-daily-sets.js';
import * as farmPcSearches from './farm-pc-searches.js';

async function abortRun(ctx, status, errorMsg) {
  ctx.session.isActivelyRunning = false;
  closeRewardsTab();
  await ctx.setState({ isRunning: false, status });
  await ctx.dbg('error', errorMsg);
  chrome.runtime.sendMessage({ action: MSG_ACTION.COMPLETE }).catch(() => {});
}

export async function run() {
  const today = new Date().toDateString();
  const { lastRunDate, currentIndex, completedSearches } = await loadState();
  const alreadyDone = lastRunDate === today && completedSearches > 0 && currentIndex >= completedSearches;

  resetSession();
  resetLog();
  await resetState({ isRunning: true, status: 'Fetching rewards activities...', lastRunDate: today });

  const ctx = createContext();
  ctx.session.isActivelyRunning = true;

  _executeRun(ctx, { today, lastRunDate, currentIndex, alreadyDone }); // fire and forget
}

async function _executeRun(ctx, { today, lastRunDate, currentIndex, alreadyDone }) {
  await ctx.dbg('info', 'Run started');

  // Open rewards dashboard and breakdown tab in parallel
  await ctx.dbg('info', `Opening ${REWARDS_URL}`);
  const activitiesPromise = fetchActivities(ctx);
  try {
    const breakdownTab = await openTab(ctx, REWARDS_BREAKDOWN_URL, false);
    ctx.session.breakdownTabId = breakdownTab.id;
  } catch {
    await ctx.dbg('warn', 'Failed to open breakdown tab — PC search counter tracking may open its own');
  }
  const activitiesResult = await activitiesPromise;
  const { activities, domDebug, loggedIn } = activitiesResult;

  if (!ctx.session.isActivelyRunning) { await ctx.dbg('warn', 'Stopped during activity fetch'); return; }

  if (!loggedIn) {
    await abortRun(ctx, 'Not logged in — sign into Bing first', 'Aborting: not logged into Bing Rewards');
    return;
  }

  await ctx.setState({ extractedActivities: activities, domDebug });
  await ctx.dbg('info', `DOM scan: ${domDebug?.actionElementsFound ?? '?'} actionable, ${domDebug?.skippedLocked ?? 0} locked, ${domDebug?.skippedCompleted ?? 0} completed, ${domDebug?.skippedUnknown ?? 0} unknown (skipped)`);

  if (activities.length === 0 && (activitiesResult.dailySets?.length ?? 0) === 0) {
    try {
      await farmPcSearches.run(ctx);
    } catch (err) {
      await ctx.dbg('error', `PC search farming failed: ${err.message}`);
    }
    await abortRun(ctx, 'No valid activity cards found — check Debug panel', 'Aborting: no valid activity cards detected on the rewards page');
    return;
  }

  await ctx.dbg('success', `Found ${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}`);

  const mapped = buildSearchList(activities);
  await ctx.setState({ mappedActivities: mapped, searchQueue: mapped.filter(m => m.query).map(m => m.query) });
  chrome.runtime.sendMessage({ action: MSG_ACTION.DEBUG_READY }).catch(() => {});

  const unmapped = mapped.filter(m => m.unmatched).length;
  await ctx.dbg('info', `Mapped ${mapped.length - unmapped}/${mapped.length} activit${mapped.length === 1 ? 'y' : 'ies'} (${unmapped} unmatched)`);

  const startIndex = (lastRunDate === today && currentIndex > 0 && !alreadyDone) ? currentIndex : 0;
  await ctx.setState({
    totalSearches: mapped.length,
    currentIndex: startIndex,
    completedSearches: startIndex,
    status: `Running (0 / ${mapped.length})`,
  });

  const initialDelay = randMs(...TIMING.INITIAL_DELAY);
  await ctx.dbg('info', `Initial delay: ${(initialDelay / 1000).toFixed(1)}s`);
  await sleep(initialDelay);

  if (!ctx.session.isActivelyRunning) { closeRewardsTab(); return; }

  // ── Chain orchestrators ──────────────────────────────────────────────────
  try {
    await completeExploreOnBing.run(ctx, mapped, startIndex);
  } catch (err) {
    await ctx.dbg('error', `Explore on Bing failed: ${err.message}`);
  }
  try {
    await completeDailySets.run(ctx, activitiesResult);
  } catch (err) {
    await ctx.dbg('error', `Daily sets failed: ${err.message}`);
  }
  try {
    await farmPcSearches.run(ctx);
  } catch (err) {
    await ctx.dbg('error', `PC search farming failed: ${err.message}`);
  }

  closeRewardsTab();
  ctx.session.isActivelyRunning = false;
  await ctx.setState({ isRunning: false, status: 'Done for today!' });
  await ctx.dbg('success', 'All tasks complete');
  chrome.runtime.sendMessage({ action: MSG_ACTION.COMPLETE }).catch(() => {});
}
