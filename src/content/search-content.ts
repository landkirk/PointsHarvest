// Injected into https://www.bing.com/* pages.
// Waits for a 'performSearch' message from the background, then types the query
// into the Bing search bar and submits the form.

import { MSG_ACTION } from '../util/messaging.js';

const SELECTORS = {
  SEARCH_BOX: '#sb_form_q',
  SEARCH_BOX_FALLBACK: 'textarea[name="q"]',
  SEARCH_FORM: '#sb_form',
} as const;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== MSG_ACTION.PERFORM_SEARCH) return;

  const textarea =
    document.querySelector<HTMLTextAreaElement>(SELECTORS.SEARCH_BOX) ??
    document.querySelector<HTMLTextAreaElement>(SELECTORS.SEARCH_BOX_FALLBACK);
  if (!textarea) {
    console.warn(
      '[search-content] Selector not found:',
      SELECTORS.SEARCH_BOX,
      '(fallback also failed)',
    );
    sendResponse({ ok: false, error: 'search box not found' });
    return true;
  }

  textarea.focus();
  textarea.value = msg.query as string;
  // Dispatch input event so Bing's JS registers the value change.
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: msg.query as string }));

  const form =
    textarea.closest('form') ?? document.querySelector<HTMLFormElement>(SELECTORS.SEARCH_FORM);
  if (!form) {
    console.warn('[search-content] Selector not found:', SELECTORS.SEARCH_FORM);
    sendResponse({ ok: false, error: 'search form not found' });
    return true;
  }

  try {
    form.requestSubmit();
    sendResponse({ ok: true });
  } catch (err) {
    sendResponse({ ok: false, error: String(err) });
  }
  return true;
});
