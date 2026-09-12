// Injected into https://www.bing.com/* pages.
// Waits for a 'performSearch' message from the background, then types the query
// into the Bing search bar and submits the form.

import { LOCATE_STATUS, MSG_ACTION, QUIZ_MOVE } from '../util/messaging.js';
import type { QuizLocateResponse } from '../util/messaging.js';
import { randMs, sleep, TIMING } from '../util/timing.js';
import { locateElement } from './dom-util.js';
import { findQuizCard, quizNext, quizOptions, quizProgress, quizQuestion } from './quiz-dom.js';
import { shuffleArray } from '../util/array.js';

const SELECTORS = {
  SEARCH_BOX: '#sb_form_q',
  SEARCH_BOX_FALLBACK: 'textarea[name="q"]',
  SEARCH_FORM: '#sb_form',
} as const;

const CLICK_RESULT_MAX_RANK = 3; // Bias toward top results (more reliable, less spam-like)

/**
 * Report where to click next on the quiz or poll module: an answer option picked
 * at random, or — when a question has been answered and the module is showing
 * its answer reveal — the "Next" control that moves on to the following
 * question. The content script only ever locates; the background dispatches the
 * click over CDP, because the module only reacts to a trusted event.
 *
 * Options are looked for first and win outright, so the reveal's "Next" can
 * never divert a click away from a question that is actually answerable.
 *
 * `aim: false` is a probe: it reports what is on screen without measuring the
 * target, since measuring scrolls the page and waits for it to settle.
 *
 * Absent means "no quiz module here", which is the caller's signal to hand the
 * activity back to the user rather than to report a failure.
 */
async function locateQuizOption(aim: boolean): Promise<QuizLocateResponse> {
  const mod = findQuizCard();
  if (!mod) return { status: LOCATE_STATUS.Absent, reason: 'no quiz or poll module on this page' };

  const progress = quizProgress(mod);
  const { options, via, state } = quizOptions(mod);

  // Nothing answerable. Before calling that "no options left", check for the
  // answer reveal's advance control: it is the normal state between questions,
  // and a quiz parked on it looks otherwise identical to a finished one.
  //
  // Not on a module that says it is over, though: the score summary's own links
  // start a different quiz or leave the site, and none of them is worth a click.
  const next = options.length === 0 && state !== 'finished' ? quizNext(mod) : null;
  const target =
    options.length > 0
      ? { el: shuffleArray(options)[0], move: QUIZ_MOVE.Answer, via }
      : next && { el: next.el, move: QUIZ_MOVE.Advance, via: next.via };

  if (target) {
    const point = aim ? await locateElement(target.el) : null;
    if (point || !aim) {
      return {
        status: LOCATE_STATUS.Ready,
        point,
        move: target.move,
        kind: mod.shape.kind,
        progress,
        question: quizQuestion(mod),
        via: target.via,
      };
    }
    if (target.move === QUIZ_MOVE.Answer) {
      return { status: LOCATE_STATUS.Absent, reason: `option not visible (via ${via})` };
    }
  }

  // No options and nothing to advance with. `state` says whether that is the
  // module telling us it was played or markup we couldn't parse — the caller
  // treats the second as "hand it back to the user", never as a finished quiz.
  return { status: LOCATE_STATUS.Satisfied, state: state ?? 'unparsed', progress, via };
}

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

  if (msg.action === MSG_ACTION.LOCATE_QUIZ_OPTION) {
    void (async () => {
      sendResponse(await locateQuizOption(msg.aim));
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
