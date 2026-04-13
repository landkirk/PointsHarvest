// Injected into https://www.bing.com/* pages.
// Waits for a 'performSearch' message from the background, then types the query
// into the Bing search bar and submits the form.

import { MSG_ACTION } from '../util/messaging.js';
import { randMs, sleep, TIMING } from '../util/timing.js';

const SELECTORS = {
  SEARCH_BOX: '#sb_form_q',
  SEARCH_BOX_FALLBACK: 'textarea[name="q"]',
  SEARCH_FORM: '#sb_form',
} as const;

const CLICK_RESULT_MAX_RANK = 3; // Bias toward top results (more reliable, less spam-like)

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === MSG_ACTION.SCROLL_PAGE) {
    window.scrollBy({ top: msg.y, behavior: msg.behavior });
    sendResponse({ ok: true });
    return;
  }

  if (msg.action === MSG_ACTION.CLICK_RESULT) {
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('#b_results .b_algo h2 a'),
    );
    if (!links.length) {
      sendResponse({ ok: false, error: 'no results found' });
      return true;
    }
    const el = links[Math.floor(Math.random() * Math.min(links.length, CLICK_RESULT_MAX_RANK))];

    (async () => {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(randMs(...TIMING.RESULT_CLICK_HOVER));

        const rect = el.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        const eventInit = { bubbles: true, cancelable: true, clientX, clientY };

        // Dispatch hover events
        el.dispatchEvent(new PointerEvent('pointerover', eventInit));
        el.dispatchEvent(new MouseEvent('mouseover', eventInit));

        // Dispatch movement events with realistic delay
        await sleep(randMs(...TIMING.CLICK_SIMULATION_MOVE_DELAY));
        el.dispatchEvent(new PointerEvent('pointermove', eventInit));
        el.dispatchEvent(new MouseEvent('mousemove', eventInit));

        // Dispatch press events with realistic hold delay
        await sleep(randMs(...TIMING.CLICK_SIMULATION_MOVE_DELAY));
        el.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, button: 0 }));
        el.dispatchEvent(new MouseEvent('mousedown', { ...eventInit, button: 0 }));
        await sleep(randMs(...TIMING.CLICK_SIMULATION_HOLD_DOWN_DELAY));

        // Dispatch release and click events
        el.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, button: 0 }));
        el.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, button: 0 }));
        await sleep(randMs(...TIMING.CLICK_SIMULATION_RELEASE_DELAY));
        el.dispatchEvent(new MouseEvent('click', { ...eventInit, button: 0 }));

        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();

    return true;
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
