// Injected into rewards.bing.com
// Waits for the SPA to render activity cards, then reports them to the background.
// Cards are clicked on demand (one at a time) via 'clickCard' messages from the background.

// Actionable cards are <a class="ds-card-sec"> elements; locked cards are <div class="locked-card">.
// "Search on Bing" activities are identified via aria-label on the card element.

import { CardState, CARD_SOURCE } from '../util/activity.js';
import { TIMING, TIMEOUTS, randMs, rawRandMs, sleep } from '../util/timing.js';
import { MSG_ACTION } from '../util/messaging.js';
import type { AppMessage } from '../util/messaging.js';
import type { RawCard, CardSource } from '../util/activity.js';

const SELECTORS = {
  DAILY_SETS_CONTAINER: '#daily-sets',
  MORE_ACTIVITIES_CONTAINER: '#more-activities',
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

const CLICK_SIMULATION = {
  COORD_OFFSET_RANGE: 3, // ±3px jitter from element center
  MOVE_COUNT_RANGE: 3, // 1–3 mouse move events
  POINTER_ID: 1 as const,
} as const;

function parseCardPoints(card: Element): number {
  const raw = card.querySelector(SELECTORS.POINTS_VALUE)?.textContent?.trim();
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : n;
}

function parseAriaTitleAndDescription(el: Element): { title: string; description: string } {
  const parts = (el.getAttribute('aria-label') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const title = parts[0] || (el.textContent ?? '').trim().slice(0, 60);
  const descP = el.querySelector(SELECTORS.CARD_DESCRIPTION);
  const description = descP ? (descP.textContent ?? '').trim() : parts.slice(1).join(', ');
  return { title, description };
}

const MAX_WAIT_MS = TIMEOUTS.REWARDS_DOM_MAX_WAIT;
const POLL_INTERVAL_MS = TIMEOUTS.REWARDS_DOM_POLL;

// Card elements retained after extraction so they can be clicked on demand.
const extractedEls = new Map<string, HTMLAnchorElement>();

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

interface SectionOpts {
  idPrefix: string;
  source: CardSource;
  getTitleDesc: (el: Element) => { title: string; description: string };
  getDataBiId?: (el: Element) => string;
}

function collectSectionCards(
  els: Element[],
  opts: SectionOpts,
  cards: RawCard[],
  cardEls: Map<string, HTMLAnchorElement>,
): void {
  let index = 0;
  for (const el of els) {
    const state = determineCardState(el);
    const href = (el as HTMLAnchorElement).href || '';
    const id = `${opts.idPrefix}${++index}`;
    const { title, description } = opts.getTitleDesc(el);
    cards.push({
      id,
      title,
      description,
      points: parseCardPoints(el),
      cardState: state,
      source: opts.source,
      dataBiId: opts.getDataBiId?.(el) ?? '',
    });
    if (href && state === CardState.Actionable) cardEls.set(id, el as HTMLAnchorElement);
  }
}

function dailyTitleDesc(el: Element): { title: string; description: string } {
  return {
    title: el.getAttribute('aria-label') || '',
    description: el.textContent?.trim().slice(0, 120) || '',
  };
}

function extractAllCards(): {
  cards: RawCard[];
  hasDailySection: boolean;
  cardEls: Map<string, HTMLAnchorElement>;
} {
  const cards: RawCard[] = [];
  const cardEls = new Map<string, HTMLAnchorElement>();

  // ── Explore section (main cards, excluding daily-sets and more-activities containers) ──
  const exploreEls = [
    ...document.querySelectorAll(SELECTORS.CARD_LOCKED),
    ...Array.from(document.querySelectorAll(SELECTORS.CARD_ACTIONABLE)).filter(
      (a) => !a.closest(SELECTORS.CARD_LOCKED),
    ),
  ].filter(
    (card) =>
      !card.closest(SELECTORS.DAILY_SETS_CONTAINER) &&
      !card.closest(SELECTORS.MORE_ACTIVITIES_CONTAINER),
  );
  collectSectionCards(
    exploreEls,
    {
      idPrefix: 'E',
      source: CARD_SOURCE.EXPLORE,
      getTitleDesc: parseAriaTitleAndDescription,
      getDataBiId: (el) => el.closest(SELECTORS.BI_TRACKED)?.getAttribute('data-bi-id') || '',
    },
    cards,
    cardEls,
  );

  // ── Daily sets section ────────────────────────────────────────────────
  const dailyContainer = document.querySelector(SELECTORS.DAILY_SETS_CONTAINER);
  if (dailyContainer) {
    collectSectionCards(
      Array.from(dailyContainer.querySelectorAll(SELECTORS.CARD_ACTIONABLE)),
      { idPrefix: 'D', source: CARD_SOURCE.DAILY_SET, getTitleDesc: dailyTitleDesc },
      cards,
      cardEls,
    );
  } else {
    console.warn('[rewards-content] Selector not found:', SELECTORS.DAILY_SETS_CONTAINER);
  }

  // ── More activities section ───────────────────────────────────────────
  const moreActivitiesContainer = document.querySelector(SELECTORS.MORE_ACTIVITIES_CONTAINER);
  if (moreActivitiesContainer) {
    collectSectionCards(
      Array.from(moreActivitiesContainer.querySelectorAll(SELECTORS.CARD_ACTIONABLE)),
      {
        idPrefix: 'M',
        source: CARD_SOURCE.MORE_ACTIVITIES,
        getTitleDesc: parseAriaTitleAndDescription,
      },
      cards,
      cardEls,
    );
  } else {
    console.warn('[rewards-content] Selector not found:', SELECTORS.MORE_ACTIVITIES_CONTAINER);
  }

  return { cards, hasDailySection: !!dailyContainer, cardEls };
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

  const poll = async () => {
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
        cards: [],
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

    window.scrollBy({ top: randMs(...TIMING.SCROLL_RANGE_PX), behavior: 'smooth' });
    await sleep(randMs(...TIMING.REWARDS_PRE_EXTRACT_SCROLL_PAUSE));
    window.scrollBy({ top: randMs(...TIMING.SCROLL_RANGE_PX), behavior: 'smooth' });
    await sleep(randMs(...TIMING.REWARDS_PRE_EXTRACT_SCROLL_PAUSE));

    const { cards, hasDailySection, cardEls } = extractAllCards();

    if (cards.length > 0 || hasDailySection || Date.now() - start >= MAX_WAIT_MS) {
      extractedEls.clear();
      cardEls.forEach((el, id) => extractedEls.set(id, el));

      chrome.runtime.sendMessage({
        action: MSG_ACTION.ACTIVITIES_FOUND,
        cards,
        loggedIn: true,
      });
    } else {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  poll();
}

function resolveEl(id: string): HTMLAnchorElement | undefined {
  return extractedEls.get(id);
}

// Return a random offset in [-range, +range]
function randomOffset(range: number): number {
  return (Math.random() * 2 - 1) * range;
}

async function simulateClick(el: HTMLAnchorElement): Promise<void> {
  const rect = el.getBoundingClientRect();
  // Validate element is visible; getBoundingClientRect still returns coords for hidden elements
  if (rect.width === 0 || rect.height === 0) {
    throw new Error('Cannot click invisible element');
  }

  // Add jitter to avoid detection by click-pattern analysis
  const cx = rect.left + rect.width / 2 + randomOffset(CLICK_SIMULATION.COORD_OFFSET_RANGE);
  const cy = rect.top + rect.height / 2 + randomOffset(CLICK_SIMULATION.COORD_OFFSET_RANGE);

  const eventOptions = {
    bubbles: true,
    cancelable: true,
    clientX: cx,
    clientY: cy,
    screenX: cx + window.screenX,
    screenY: cy + window.screenY,
    view: window,
    pointerId: CLICK_SIMULATION.POINTER_ID,
    pointerType: 'mouse' as const,
  };

  el.dispatchEvent(new PointerEvent('pointerover', eventOptions));

  const moveCount = Math.floor(Math.random() * CLICK_SIMULATION.MOVE_COUNT_RANGE) + 1;
  for (let i = 0; i < moveCount; i++) {
    el.dispatchEvent(new PointerEvent('pointermove', eventOptions));
    await sleep(rawRandMs(...TIMING.CLICK_SIMULATION_MOVE_DELAY));
  }

  const pointerdownOptions = { ...eventOptions, buttons: 1 };
  el.dispatchEvent(new PointerEvent('pointerdown', pointerdownOptions));
  await sleep(rawRandMs(...TIMING.CLICK_SIMULATION_HOLD_DOWN_DELAY));

  // pointerup has buttons: 0 per pointer event spec (button released)
  el.dispatchEvent(new PointerEvent('pointerup', eventOptions));
  await sleep(rawRandMs(...TIMING.CLICK_SIMULATION_RELEASE_DELAY));

  el.dispatchEvent(new MouseEvent('click', eventOptions));
}

chrome.runtime.onMessage.addListener((msg: AppMessage, _sender, sendResponse) => {
  if (msg.action === MSG_ACTION.START_EXTRACT) {
    waitAndExtract();
    return undefined;
  }

  if (msg.action === MSG_ACTION.CLICK_CARD) {
    const card = resolveEl(msg.id);
    if (!card) {
      sendResponse({ clicked: false, error: `no card with id ${msg.id}` });
      return true;
    }
    // Return promise directly so Chrome properly awaits the response
    simulateClick(card)
      .then(() => sendResponse({ clicked: true }))
      .catch((err) => sendResponse({ clicked: false, error: String(err) }));
    return true;
  }

  if (msg.action === MSG_ACTION.GET_COUNTERS) {
    const { searchCounters } = extractSearchCounters();
    sendResponse({ searchCounters });
    return true;
  }

  if (msg.action === MSG_ACTION.VALIDATE_ACTIVITY) {
    const card = resolveEl(msg.id);
    sendResponse({ state: card ? determineCardState(card) : CardState.NotFound });
    return true;
  }
  return undefined;
});
