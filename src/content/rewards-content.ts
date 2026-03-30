// Injected into rewards.bing.com
// Waits for the SPA to render activity cards, then reports them to the background.
// Cards are clicked on demand (one at a time) via 'clickCard' messages from the background.

// Actionable cards are <a class="ds-card-sec"> elements; locked cards are <div class="locked-card">.
// "Search on Bing" activities are identified via aria-label on the card element.

import { CardState } from '../util/activity.js';
import { TIMEOUTS } from '../util/timing.js';
import { MSG_ACTION } from '../util/messaging.js';
import { ACTIVITY_TYPE } from '../util/activity.js';
import type { AppMessage } from '../util/messaging.js';
import type { ActivityType } from '../util/activity.js';
import type { Activity } from '../util/activity.js';
import type { ActivityScan, ActivityScanEntry } from '../util/debug.js';

const SELECTORS = {
  DAILY_SETS_CONTAINER: '#daily-sets',
  CARD_ACTIONABLE: 'a.ds-card-sec',
  CARD_LOCKED: '.locked-card',
  POINTS_EARNED: '[aria-label="Points you have earned"]',
  POINTS_IN_PROGRESS: '[aria-label="Points in progress"]',
  POINTS_WILL_EARN: '[aria-label="Points you will earn"]',
  BI_TRACKED: '[data-bi-id]',
  COUNTER_CARD: '.pointsBreakdownCard',
  COUNTER_TITLE: '.title-detail p',
  COUNTER_DETAIL: 'p.pointsDetail',
  CARD_DESCRIPTION: '.contentContainer p',
  POINTS_VALUE: '.pointsString',
} as const;

function parseCardPoints(card: Element): number {
  const raw = card.querySelector(SELECTORS.POINTS_VALUE)?.textContent?.trim();
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : n;
}

const SEARCH_ON_BING_RE = /search (?:on|using|with) bing/i;

function countSkipped(entries: ActivityScanEntry[], reason: CardState): number {
  return entries.filter((a) => a.skipReason === reason).length;
}

function buildActivityScan(entries: ActivityScanEntry[], actionableCount: number): ActivityScan {
  return {
    actionableActivities: actionableCount,
    skippedLocked: countSkipped(entries, CardState.Locked),
    skippedCompleted: countSkipped(entries, CardState.Completed),
    activities: entries,
  };
}
const MAX_WAIT_MS = TIMEOUTS.REWARDS_DOM_MAX_WAIT;
const POLL_INTERVAL_MS = TIMEOUTS.REWARDS_DOM_POLL;

// Card elements retained after extraction so they can be clicked on demand.
let extractedCardEls: HTMLAnchorElement[] = [];
let extractedDailySetEls: HTMLAnchorElement[] = [];

// Returns a CardState. Locked check must come first — locked cards still contain the points-earned span.
// In-progress cards (hourglass icon, "Activated!" tooltip) are treated as actionable.
function determineCardState(card: Element): CardState {
  if (card.closest(SELECTORS.CARD_LOCKED)) return CardState.Locked;
  if (card.getAttribute('aria-disabled') === 'true') return CardState.Locked;
  if (card.querySelector(SELECTORS.POINTS_EARNED)) return CardState.Completed;
  if (card.querySelector(SELECTORS.POINTS_IN_PROGRESS)) return CardState.Actionable;
  if (card.querySelector(SELECTORS.POINTS_WILL_EARN)) return CardState.Actionable;
  return CardState.Unknown;
}

// Returns { dailySets, dailySetDebug, dailySetEls }
function extractDailySets(): {
  dailySets: Activity[];
  dailySetDebug: ActivityScan | null;
  dailySetEls: HTMLAnchorElement[];
} {
  const container = document.querySelector(SELECTORS.DAILY_SETS_CONTAINER);
  if (!container) {
    console.warn('[rewards-content] Selector not found:', SELECTORS.DAILY_SETS_CONTAINER);
    return { dailySets: [], dailySetDebug: null, dailySetEls: [] };
  }

  const els = Array.from(container.querySelectorAll(SELECTORS.CARD_ACTIONABLE));

  const actionable: Activity[] = [];
  const dailySetEls: HTMLAnchorElement[] = [];
  const activities: ActivityScanEntry[] = [];

  for (const el of els) {
    const state = determineCardState(el);
    const ariaLabel = el.getAttribute('aria-label') || '';
    const href = (el as HTMLAnchorElement).href || '';
    const snippet = ariaLabel.slice(0, 80);

    if (!href) continue;
    const pts = parseCardPoints(el);
    if (state !== CardState.Actionable) {
      activities.push({ skipReason: state, snippet, points: pts });
      continue;
    }

    activities.push({ snippet, skipReason: null, points: pts });
    actionable.push({
      title: ariaLabel,
      description: el.textContent?.trim().slice(0, 120) || '',
      activityIndex: dailySetEls.length,
      activityType: ACTIVITY_TYPE.DAILY_SET,
      points: pts,
    });
    dailySetEls.push(el as HTMLAnchorElement);
  }

  return {
    dailySets: actionable,
    dailySetDebug: buildActivityScan(activities, actionable.length),
    dailySetEls,
  };
}

// Returns { searchCounters, searchCounterDebug }
function extractSearchCounters(): {
  searchCounters: { type: string; current: number; max: number }[];
} {
  const cards = Array.from(document.querySelectorAll(SELECTORS.COUNTER_CARD));
  if (cards.length === 0) {
    console.warn('[rewards-content] Selector not found:', SELECTORS.COUNTER_CARD);
  }
  const counters: { type: string; current: number; max: number }[] = [];

  for (const card of cards) {
    const type = card.querySelector(SELECTORS.COUNTER_TITLE)?.textContent?.trim() || '';
    const rawText = card.querySelector(SELECTORS.COUNTER_DETAIL)?.textContent?.trim() || '';

    // rawText example: "5 / 150"
    const parts = rawText.split('/');
    if (parts.length < 2) continue;

    const current = parseInt(parts[0].trim());
    const max = parseInt(parts[1].trim());
    if (!type || isNaN(current) || isNaN(max)) continue;

    counters.push({ type, current, max });
  }

  return { searchCounters: counters };
}

// Returns { activities, domDebug, cardEls }
function extractActivities(): {
  activities: Activity[];
  domDebug: ActivityScan;
  cardEls: HTMLAnchorElement[];
} {
  // Select locked card divs first, then actionable anchors that are NOT inside a locked div.
  const allCards = [
    ...document.querySelectorAll(SELECTORS.CARD_LOCKED),
    ...Array.from(document.querySelectorAll(SELECTORS.CARD_ACTIONABLE)).filter(
      (a) => !a.closest(SELECTORS.CARD_LOCKED),
    ),
  ].filter((card) => !card.closest(SELECTORS.DAILY_SETS_CONTAINER));

  const activities: Activity[] = [];
  const cardEls: HTMLAnchorElement[] = [];
  const skipped: ActivityScanEntry[] = [];

  for (const card of allCards) {
    const ariaLabel = card.getAttribute('aria-label') || '';
    const cardText = card.textContent || '';

    const parentBiId = card.closest(SELECTORS.BI_TRACKED)?.getAttribute('data-bi-id') || '';
    if (
      !SEARCH_ON_BING_RE.test(ariaLabel) &&
      !SEARCH_ON_BING_RE.test(cardText) &&
      !parentBiId.includes('exploreonbing')
    )
      continue;

    const snippet = (ariaLabel || cardText.trim()).slice(0, 120);
    const pts = parseCardPoints(card);
    const state = determineCardState(card);
    if (state !== CardState.Actionable) {
      skipped.push({ skipReason: state, snippet, points: pts });
      continue;
    }

    const parts = ariaLabel
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const title = parts[0] || cardText.trim().slice(0, 60);

    // Description: prefer the <p> inside .contentContainer — clean "Search on Bing to/for …" text.
    const descP = card.querySelector(SELECTORS.CARD_DESCRIPTION);
    const description = descP ? (descP.textContent ?? '').trim() : parts.slice(1).join(', ');
    const href = (card as HTMLAnchorElement).href || '';

    if (!href) continue;
    activities.push({ title, description, activityIndex: cardEls.length, points: pts });
    cardEls.push(card as HTMLAnchorElement);
  }

  const domDebug = buildActivityScan(skipped, cardEls.length);

  return { activities, domDebug, cardEls };
}

// Returns true if the rewards dashboard is visible (i.e. user is logged in).
function isLoggedIn(rawText: string): boolean | null {
  const bodyText = rawText.toLowerCase();

  const DASHBOARD_SIGNALS = [
    'available points',
    "today's points",
    'streak count',
    'streak protection',
    'explore on bing',
    'points breakdown',
  ];
  if (DASHBOARD_SIGNALS.some((s: string) => bodyText.includes(s))) return true;

  const LOGOUT_SIGNALS = ['sign in to start earning', 'sign in to earn', 'start earning rewards'];
  if (LOGOUT_SIGNALS.some((s: string) => bodyText.includes(s))) return false;

  return null; // inconclusive — page may still be loading
}

function waitAndExtract(): void {
  const start = Date.now();

  const poll = () => {
    const bodyText = document.body?.textContent || '';
    if (bodyText.trim().length < 50) {
      if (Date.now() - start < MAX_WAIT_MS) {
        setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }
    }

    const loginStatus = isLoggedIn(bodyText);
    if (loginStatus === false) {
      chrome.runtime.sendMessage({
        action: MSG_ACTION.ACTIVITIES_FOUND,
        activities: [],
        domDebug: null,
        loggedIn: false,
      });
      return;
    }
    if (loginStatus === null) {
      if (Date.now() - start < MAX_WAIT_MS) {
        setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }
    }

    const { activities, domDebug, cardEls } = extractActivities();
    const { dailySets, dailySetDebug, dailySetEls } = extractDailySets();

    if (
      activities.length > 0 ||
      dailySets.length > 0 ||
      domDebug.actionableActivities > 0 ||
      dailySetDebug !== null ||
      Date.now() - start >= MAX_WAIT_MS
    ) {
      extractedCardEls = cardEls;
      extractedDailySetEls = dailySetEls;

      const alreadyCompletedPoints = domDebug.activities.reduce(
        (sum, e) => (e.skipReason === CardState.Completed ? sum + (e.points) : sum),
        0,
      );
      const dailyAlreadyCompletedPoints = (dailySetDebug?.activities ?? []).reduce(
        (sum, e) => (e.skipReason === CardState.Completed ? sum + (e.points) : sum),
        0,
      );

      chrome.runtime.sendMessage({
        action: MSG_ACTION.ACTIVITIES_FOUND,
        activities,
        domDebug,
        dailySets,
        dailySetDebug,
        alreadyCompletedCount: domDebug.skippedCompleted,
        dailyAlreadyCompletedCount: dailySetDebug?.skippedCompleted ?? 0,
        alreadyCompletedPoints,
        dailyAlreadyCompletedPoints,
        loggedIn: true,
      });
    } else {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  poll();
}

function resolveEls(target: ActivityType | undefined): HTMLAnchorElement[] {
  return target === ACTIVITY_TYPE.DAILY_SET ? extractedDailySetEls : extractedCardEls;
}

chrome.runtime.onMessage.addListener((msg: AppMessage, _sender, sendResponse) => {
  if (msg.action === MSG_ACTION.START_EXTRACT) {
    waitAndExtract();
    return undefined;
  }

  if (msg.action === MSG_ACTION.CLICK_CARD) {
    const els = resolveEls(msg.target);
    const card = els[msg.index];
    if (!card) {
      sendResponse({ clicked: false, error: `no card at index ${msg.index}` });
      return true;
    }
    try {
      card.click();
      sendResponse({ clicked: true });
    } catch (err) {
      sendResponse({ clicked: false, error: String(err) });
    }
    return true;
  }

  if (msg.action === MSG_ACTION.GET_COUNTERS) {
    const { searchCounters } = extractSearchCounters();
    sendResponse({ searchCounters });
    return true;
  }

  if (msg.action === MSG_ACTION.VALIDATE_ACTIVITY) {
    const els = resolveEls(msg.target);
    const card = els[msg.index];
    sendResponse({ state: card ? determineCardState(card) : CardState.NotFound });
    return true;
  }
  return undefined;
});
