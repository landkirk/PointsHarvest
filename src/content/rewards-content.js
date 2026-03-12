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

// Returns 'actionable', 'completed', 'locked', or 'unknown'.
// Locked check must come first — locked cards still contain the points-earned span.
function cardState(card) {
  if (card.closest('.locked-card'))                               return 'locked';
  if (card.querySelector('[aria-label="Points you have earned"]')) return 'completed';
  if (card.querySelector('[aria-label="Points you will earn"]'))   return 'actionable';
  return 'unknown';
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
    const state = cardState(card);
    if (state !== 'actionable') {
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
    skippedLocked: debugCards.filter(d => d.skipped === 'locked').length,
    skippedCompleted: debugCards.filter(d => d.skipped === 'completed').length,
    skippedUnknown: debugCards.filter(d => d.skipped === 'unknown').length,
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
      chrome.runtime.sendMessage({ action: 'activitiesFound', activities: [], domDebug: null, loggedIn: false });
      return;
    }
    if (loginStatus === null) {
      if (Date.now() - start < MAX_WAIT_MS) { setTimeout(poll, POLL_INTERVAL_MS); return; }
    }

    const { activities, domDebug, cardEls } = extractActivities();

    if (activities.length > 0 || Date.now() - start >= MAX_WAIT_MS) {
      extractedCardEls = cardEls; // retain for on-demand clicks
      chrome.runtime.sendMessage({ action: 'activitiesFound', activities, domDebug, loggedIn: true });
    } else {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  poll();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'startExtract') {
    waitAndExtract();
    return;
  }

  if (msg.action === 'clickCard') {
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
});
