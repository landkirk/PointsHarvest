// Injected into https://www.bing.com/* pages.
// Waits for a 'performSearch' message from the background, then types the query
// into the Bing search bar and submits the form.

// Content scripts run as classic scripts (not ES modules), so they cannot import from config.js.
// MSG_ACTION is duplicated here intentionally — the canonical definition lives in util/config.js.
const SEARCH_MSG_ACTION = { PERFORM_SEARCH: 'performSearch' } as const;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== SEARCH_MSG_ACTION.PERFORM_SEARCH) return;

  const textarea = document.querySelector<HTMLTextAreaElement>('#sb_form_q');
  if (!textarea) {
    sendResponse({ ok: false, error: 'search box not found' });
    return true;
  }

  textarea.focus();
  textarea.value = msg.query as string;
  // Dispatch input event so Bing's JS registers the value change.
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: msg.query as string }));

  const form = textarea.closest('form') ?? document.querySelector<HTMLFormElement>('#sb_form');
  if (!form) {
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
