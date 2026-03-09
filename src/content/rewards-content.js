// Injected into rewards.bing.com
// Waits for the SPA to render activity cards, then reports them to the background.
// Cards are clicked on demand (one at a time) via 'clickCard' messages from the background.

// Cards are <a class="ds-card-sec"> elements.
// "Search on Bing" activities are identified via aria-label on the card anchor.
const SEARCH_ON_BING_RE = /search on bing/i;
const LOCKED_KEYWORDS = ['locked', 'available on', 'coming soon'];
const MAX_WAIT_MS = 15000;
const POLL_INTERVAL_MS = 500;

// Card elements retained after extraction so they can be clicked on demand.
let extractedCardEls = [];

function isLocked(text) {
  const t = text.toLowerCase();
  return LOCKED_KEYWORDS.some(kw => t.includes(kw));
}

// Returns { activities, domDebug, cardEls }
function extractActivities() {
  const allCards = Array.from(document.querySelectorAll('a.ds-card-sec'));

  const activities = [];
  const cardEls = [];
  const debugCards = [];
  let skippedLocked = 0;

  for (const card of allCards) {
    const ariaLabel = card.getAttribute('aria-label') || '';
    const cardText  = card.textContent || '';

    if (!SEARCH_ON_BING_RE.test(ariaLabel) && !SEARCH_ON_BING_RE.test(cardText)) continue;

    const ariaLower = ariaLabel.toLowerCase();
    const cardLower = cardText.toLowerCase();
    const descText  = (ariaLabel || cardText.trim()).slice(0, 120);

    if (LOCKED_KEYWORDS.some(kw => ariaLower.includes(kw) || cardLower.includes(kw))) {
      skippedLocked++;
      debugCards.push({ skipped: 'locked', cardSnippet: descText });
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
    skippedLocked,
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
