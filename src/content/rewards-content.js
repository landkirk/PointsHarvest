// Injected into rewards.bing.com
// Waits for the SPA to render activity cards, then reports them to the background.
// Cards are clicked on demand (one at a time) via 'clickCard' messages from the background.

// Actionable cards are <a class="ds-card-sec"> elements; locked cards are <div class="locked-card">.
// "Search on Bing" activities are identified via aria-label on the card element.
const SEARCH_ON_BING_RE = /search on bing/i;
const MAX_WAIT_MS = 15000;
const POLL_INTERVAL_MS = 500;

// Card elements retained after extraction so they can be clicked on demand.
let extractedCardEls = [];

// Content scripts run as classic scripts (not ES modules), so they cannot import from config.js.
// MSG_ACTION and CARD_STATE are duplicated here intentionally — the canonical definitions live in util/config.js.
/** @typedef {'startExtract'|'activitiesFound'|'clickCard'|'validateTile'|'getCounters'} MsgAction */
const MSG_ACTION = /** @type {Record<string, MsgAction>} */ ({
  START_EXTRACT:    'startExtract',
  ACTIVITIES_FOUND: 'activitiesFound',
  CLICK_CARD:       'clickCard',
  VALIDATE_TILE:    'validateTile',
  GET_COUNTERS:     'getCounters',
});

// Duplicated from util/config.js — see note above.
/** @typedef {'actionable'|'completed'|'locked'|'unknown'|'not-found'} CardState */
const CARD_STATE = /** @type {Record<string, CardState>} */ ({
  ACTIONABLE: 'actionable',
  COMPLETED:  'completed',
  LOCKED:     'locked',
  UNKNOWN:    'unknown',
  NOT_FOUND:  'not-found',
});

// Returns a CardState. Locked check must come first — locked cards still contain the points-earned span.
// In-progress cards (hourglass icon, "Activated!" tooltip) are treated as actionable.
function determineCardState(card) {
  if (card.closest('.locked-card'))                               return CARD_STATE.LOCKED;
  if (card.getAttribute('aria-disabled') === 'true')              return CARD_STATE.LOCKED;
  if (card.querySelector('[aria-label="Points you have earned"]')) return CARD_STATE.COMPLETED;
  if (card.querySelector('[aria-label="Points in progress"]'))     return CARD_STATE.ACTIONABLE;
  if (card.querySelector('[aria-label="Points you will earn"]'))   return CARD_STATE.ACTIONABLE;
  return CARD_STATE.UNKNOWN;
}

// Returns { dailySets, dailySetDebug }
function extractDailySets() {
  const container = document.querySelector('#daily-sets');
  if (!container) return { dailySets: [], dailySetDebug: { sectionFound: false } };

  const tiles = Array.from(container.querySelectorAll('a.ds-card-sec'));

  const actionable = [];
  const debugTiles = [];

  for (const tile of tiles) {
    const tileState = determineCardState(tile);
    const ariaLabel = tile.getAttribute('aria-label') || '';
    const href = tile.href || null;
    const biId = tile.getAttribute('data-bi-id') || '';
    const snippet = ariaLabel.slice(0, 80);

    if (tileState !== CARD_STATE.ACTIONABLE || !href) {
      debugTiles.push({ skipped: !href ? 'no-href' : tileState, snippet, biId });
      continue;
    }

    debugTiles.push({ href, snippet, biId, skipped: null });
    actionable.push({ href, ariaLabel, biId });
  }

  return {
    dailySets: actionable,
    dailySetDebug: {
      sectionFound: true,
      totalTiles: tiles.length,
      actionable: actionable.length,
      tiles: debugTiles,
    },
  };
}

// Returns { searchCounters, searchCounterDebug }
function extractSearchCounters() {
  const cards = Array.from(document.querySelectorAll('.pointsBreakdownCard'));
  if (!cards.length) return { searchCounters: [], searchCounterDebug: { sectionFound: false } };

  const counters = [];
  const debugCards = [];

  for (const card of cards) {
    const typeEl   = card.querySelector('.title-detail p');
    const type     = typeEl?.textContent?.trim() || '';
    const pointsEl = card.querySelector('p.pointsDetail');
    const rawText  = pointsEl?.textContent?.trim() || '';

    // rawText example: "5 / 150"
    const parts   = rawText.split('/');
    if (parts.length < 2) {
      debugCards.push({ skipped: 'parse-failed', type, rawText });
      continue;
    }
    const current = parseInt(parts[0].trim());
    const max     = parseInt(parts[1].trim());

    if (!type || isNaN(current) || isNaN(max)) {
      debugCards.push({ skipped: 'parse-failed', type, rawText });
      continue;
    }

    debugCards.push({ type, current, max, skipped: null });
    counters.push({ type, current, max });
  }

  return {
    searchCounters: counters,
    searchCounterDebug: {
      sectionFound: true,
      total: cards.length,
      extracted: counters.length,
      cards: debugCards,
    },
  };
}

// Returns { activities, domDebug, cardEls }
function extractActivities() {
  // Select locked card divs first, then actionable anchors that are NOT inside a locked div.
  const allCards = [
    ...document.querySelectorAll('.locked-card'),
    ...Array.from(document.querySelectorAll('a.ds-card-sec')).filter(a => !a.closest('.locked-card')),
  ];

  const activities = [];
  const cardEls = [];
  const debugCards = [];

  for (const card of allCards) {
    const ariaLabel = card.getAttribute('aria-label') || '';
    const cardText  = card.textContent || '';

    if (!SEARCH_ON_BING_RE.test(ariaLabel) && !SEARCH_ON_BING_RE.test(cardText)) continue;

    const descText = (ariaLabel || cardText.trim()).slice(0, 120);
    const state = determineCardState(card);
    if (state !== CARD_STATE.ACTIONABLE) {
      debugCards.push({ skipped: state, cardSnippet: descText });
      continue;
    }

    const parts = ariaLabel.split(',').map(s => s.trim()).filter(Boolean);
    const title = parts[0] || cardText.trim().slice(0, 60);

    // Description: prefer the <p> inside .contentContainer — clean "Search on Bing to/for …" text.
    const descP = card.querySelector('.contentContainer p');
    const description = descP
      ? descP.textContent.trim()
      : parts.slice(1).join(', ');
    const href = card.href || null;

    debugCards.push({ title, description, href, skipped: null });
    activities.push({ title, description, href });
    cardEls.push(card);
  }

  const domDebug = {
    totalCards: allCards.length,
    actionElementsFound: cardEls.length,
    skippedLocked: debugCards.filter(d => d.skipped === CARD_STATE.LOCKED).length,
    skippedCompleted: debugCards.filter(d => d.skipped === CARD_STATE.COMPLETED).length,
    skippedUnknown: debugCards.filter(d => d.skipped === CARD_STATE.UNKNOWN).length,
    cards: debugCards,
  };

  return { activities, domDebug, cardEls };
}

// Returns true if the rewards dashboard is visible (i.e. user is logged in).
function isLoggedIn(rawText) {
  const bodyText = (rawText ?? document.body?.textContent ?? '').toLowerCase();

  const DASHBOARD_SIGNALS = [
    'available points',
    "today's points",
    'streak count',
    'streak protection',
    'explore on bing',
    'points breakdown',
  ];
  if (DASHBOARD_SIGNALS.some(s => bodyText.includes(s))) return true;

  const LOGOUT_SIGNALS = [
    'sign in to start earning',
    'sign in to earn',
    'start earning rewards',
  ];
  if (LOGOUT_SIGNALS.some(s => bodyText.includes(s))) return false;

  return null; // inconclusive — page may still be loading
}

function waitAndExtract() {
  const start = Date.now();

  const poll = () => {
    const bodyText = document.body?.textContent || '';
    if (bodyText.trim().length < 50) {
      if (Date.now() - start < MAX_WAIT_MS) { setTimeout(poll, POLL_INTERVAL_MS); return; }
    }

    const loginStatus = isLoggedIn(bodyText);
    if (loginStatus === false) {
      chrome.runtime.sendMessage({ action: MSG_ACTION.ACTIVITIES_FOUND, activities: [], domDebug: null, loggedIn: false });
      return;
    }
    if (loginStatus === null) {
      if (Date.now() - start < MAX_WAIT_MS) { setTimeout(poll, POLL_INTERVAL_MS); return; }
    }

    const { activities, domDebug, cardEls } = extractActivities();
    const { dailySets, dailySetDebug } = extractDailySets();

    if (activities.length > 0 || dailySets.length > 0 || domDebug.totalCards > 0 || dailySetDebug.sectionFound || Date.now() - start >= MAX_WAIT_MS) {
      extractedCardEls = cardEls; // retain for on-demand clicks
      chrome.runtime.sendMessage({ action: MSG_ACTION.ACTIVITIES_FOUND, activities, domDebug, dailySets, dailySetDebug, loggedIn: true });
    } else {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  poll();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === MSG_ACTION.START_EXTRACT) {
    waitAndExtract();
    return;
  }

  if (msg.action === MSG_ACTION.CLICK_CARD) {
    const card = extractedCardEls[msg.index];
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
    const { searchCounters, searchCounterDebug } = extractSearchCounters();
    sendResponse({ searchCounters, searchCounterDebug });
    return true;
  }

  if (msg.action === MSG_ACTION.VALIDATE_TILE) {
    const tiles = Array.from(document.querySelectorAll('a.ds-card-sec'));
    const match = tiles.find(el => el.href === msg.href);
    sendResponse({ state: match ? determineCardState(match) : CARD_STATE.NOT_FOUND });
    return true;
  }
});
