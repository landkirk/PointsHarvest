// Injected into https://www.bing.com/* pages.
// Waits for a 'performSearch' message from the background, then types the query
// into the Bing search bar and submits the form.

import { MSG_ACTION } from '../util/messaging.js';
import { randMs, sleep } from '../util/timing.js';

const SELECTORS = {
  SEARCH_BOX: '#sb_form_q',
  SEARCH_BOX_FALLBACK: 'textarea[name="q"]',
  SEARCH_FORM: '#sb_form',
} as const;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === MSG_ACTION.SCROLL_PAGE) {
    window.scrollBy({ top: msg.y, behavior: msg.behavior });
    sendResponse({ ok: true });
    return;
  }

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

  const form =
    textarea.closest('form') ?? document.querySelector<HTMLFormElement>(SELECTORS.SEARCH_FORM);
  if (!form) {
    console.warn('[search-content] Selector not found:', SELECTORS.SEARCH_FORM);
    sendResponse({ ok: false, error: 'search form not found' });
    return true;
  }

  // Async work — must return true synchronously to keep the response channel open.
  (async () => {
    try {
      textarea.focus();

      // Clear existing text by simulating select-all + delete.
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
      );
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      textarea.value = '';
      textarea.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }),
      );

      // Type character by character with randomized delays.
      for (const ch of msg.query as string) {
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
        textarea.value += ch;
        textarea.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }),
        );
        textarea.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
        // 5% chance of a hesitation pause (200–400ms), otherwise normal keystroke delay (40–120ms).
        const delay = Math.random() < 0.05 ? randMs(200, 400) : randMs(40, 120);
        await sleep(delay);
      }

      // Brief pause before submitting.
      await sleep(randMs(150, 300));
      form.requestSubmit();
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true;
});
