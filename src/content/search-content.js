// Injected into https://www.bing.com/* pages.
// Waits for a 'performSearch' message from the background, then types the query
// into the Bing search bar and submits the form.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'performSearch') return;

  const textarea = document.querySelector('#sb_form_q');
  if (!textarea) {
    sendResponse({ ok: false, error: 'search box not found' });
    return true;
  }

  textarea.focus();
  textarea.value = msg.query;
  // Dispatch input event so Bing's JS registers the value change.
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: msg.query }));

  const form = textarea.closest('form') || document.querySelector('#sb_form');
  if (!form) {
    sendResponse({ ok: false, error: 'search form not found' });
    return true;
  }

  form.requestSubmit();
  sendResponse({ ok: true });
  return true;
});
