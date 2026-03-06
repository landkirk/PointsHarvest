// Injected into rewards.bing.com
// Waits for the SPA to render activity cards, then extracts available (incomplete, unlocked) ones.

const AVAILABLE_STATUSES = ['complete', 'explore now'];
const LOCKED_KEYWORDS = ['locked', 'available on', 'coming soon'];
const MAX_WAIT_MS = 15000;
const POLL_INTERVAL_MS = 500;

function isAvailableAction(text) {
  const t = text.toLowerCase().trim();
  return AVAILABLE_STATUSES.some(s => t.includes(s));
}

function isLocked(cardText) {
  const t = cardText.toLowerCase();
  return LOCKED_KEYWORDS.some(kw => t.includes(kw));
}

// Walk up the DOM from a target element to find a card-like ancestor.
// A "card" is an ancestor that contains a point value (10, 20, 50) and enough text to be meaningful.
function findCardAncestor(el) {
  let node = el.parentElement;
  for (let i = 0; i < 8; i++) {
    if (!node) break;
    if (node.children.length >= 2) {
      const text = node.textContent;
      if (/\b(10|20|50)\b/.test(text) && text.length > 30) {
        return node;
      }
    }
    node = node.parentElement;
  }
  return null;
}

// Extract a clean title + description from a card element.
function extractCardText(card) {
  const texts = [];
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    const t = node.textContent.trim();
    if (t.length < 4) continue;
    if (/^\d+$/.test(t)) continue;
    if (isAvailableAction(t)) continue;
    texts.push(t);
  }
  return {
    title: texts[0] || '',
    description: texts.slice(1).join(' '),
    rawTexts: texts, // kept for debug
  };
}

function extractActivities() {
  const allElements = Array.from(document.querySelectorAll('a, button, span, div'));
  const actionEls = allElements.filter(el =>
    el.children.length === 0 && isAvailableAction(el.textContent)
  );

  const seen = new Set();
  const activities = [];
  const debugCards = []; // one entry per candidate card, for debug display
  let skippedLocked = 0;
  let skippedNoCard = 0;

  for (const el of actionEls) {
    const actionText = el.textContent.trim();
    const card = findCardAncestor(el);

    if (!card) {
      skippedNoCard++;
      debugCards.push({ actionText, skipped: 'no card ancestor found' });
      continue;
    }

    if (seen.has(card)) continue;
    seen.add(card);

    if (isLocked(card.textContent)) {
      skippedLocked++;
      debugCards.push({ actionText, skipped: 'locked', cardSnippet: card.textContent.slice(0, 80) });
      continue;
    }

    const { title, description, rawTexts } = extractCardText(card);
    if (!title && !description) {
      debugCards.push({ actionText, skipped: 'empty title+description' });
      continue;
    }

    debugCards.push({ actionText, title, description, rawTexts, skipped: null });
    activities.push({ title, description });
  }

  const domDebug = {
    totalElements: allElements.length,
    actionElementsFound: actionEls.length,
    skippedLocked,
    skippedNoCard,
    cards: debugCards,
  };

  return { activities, domDebug };
}

// Returns true if the rewards dashboard is visible (i.e. user is logged in).
// Checks for POSITIVE indicators of a logged-in dashboard rather than trying
// to spot sign-in buttons (which can appear even on a logged-in page in nav/footer).
// Accepts pre-read body text to avoid a redundant innerText read in the poll loop.
function isLoggedIn(rawText) {
  const bodyText = (rawText ?? document.body?.innerText ?? '').toLowerCase();

  // These strings only appear on a loaded, authenticated dashboard
  const DASHBOARD_SIGNALS = [
    'available points',
    "today's points",
    'streak count',
    'streak protection',
    'explore on bing',
    'points breakdown',
  ];

  if (DASHBOARD_SIGNALS.some(s => bodyText.includes(s))) return true;

  // Explicit logged-out landing page phrases — only flag if clearly unauthenticated
  const LOGOUT_SIGNALS = [
    'sign in to start earning',
    'sign in to earn',
    'start earning rewards',
  ];

  if (LOGOUT_SIGNALS.some(s => bodyText.includes(s))) return false;

  // Inconclusive — page may still be loading, let the poll loop retry
  return null;
}

function waitAndExtract() {
  const start = Date.now();

  const poll = () => {
    // Read innerText once per tick — used for both the length guard and login detection
    const bodyText = document.body?.innerText || '';
    if (bodyText.trim().length < 50) {
      if (Date.now() - start < MAX_WAIT_MS) { setTimeout(poll, POLL_INTERVAL_MS); return; }
    }

    const loginStatus = isLoggedIn(bodyText);
    if (loginStatus === false) {
      chrome.runtime.sendMessage({ action: 'activitiesFound', activities: [], domDebug: null, loggedIn: false });
      return;
    }
    if (loginStatus === null) {
      // Inconclusive — page may still be loading; keep polling
      if (Date.now() - start < MAX_WAIT_MS) { setTimeout(poll, POLL_INTERVAL_MS); return; }
    }

    const { activities, domDebug } = extractActivities();

    if (activities.length > 0 || Date.now() - start >= MAX_WAIT_MS) {
      chrome.runtime.sendMessage({ action: 'activitiesFound', activities, domDebug, loggedIn: true });
    } else {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  poll();
}

waitAndExtract();
