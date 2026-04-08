import { MSG_ACTION } from '../util/messaging.js';
import type { UserPreferences } from '../util/persistent-state.js';

// ── DOM refs ────────────────────────────────────────────────────────────────

const skipWarmUpCheck = document.getElementById('skip-warmup-check') as HTMLInputElement;
const disableNotificationsCheck = document.getElementById(
  'disable-notifications-check',
) as HTMLInputElement;
const debugCheck = document.getElementById('debug-check') as HTMLInputElement;
const prefsPanel = document.getElementById('prefs-panel') as HTMLElement;
const prefsHeader = prefsPanel.querySelector('.prefs-header') as HTMLElement;

// ── Saved flash ──────────────────────────────────────────────────────────────

let savedTimeout: ReturnType<typeof setTimeout> | null = null;

function flashSaved(): void {
  prefsHeader.classList.add('saved');
  if (savedTimeout) clearTimeout(savedTimeout);
  savedTimeout = setTimeout(() => {
    prefsHeader.classList.remove('saved');
    savedTimeout = null;
  }, 1200);
}

// ── Public API ──────────────────────────────────────────────────────────────

export function getSkipWarmUp(): boolean {
  return skipWarmUpCheck.checked;
}

export function getDebugMode(): boolean {
  return debugCheck.checked;
}

/** Sync checkbox states from a freshly-loaded UserPreferences object. */
export function renderPrefs(prefs: UserPreferences): void {
  skipWarmUpCheck.checked = prefs.skipWarmUp;
  disableNotificationsCheck.checked = prefs.disableNotifications;
  debugCheck.checked = prefs.debugMode;
}

/** Attach change listeners. Call once at startup. */
export function bindPrefs(): void {
  prefsHeader.addEventListener('click', () => {
    prefsPanel.classList.toggle('collapsed');
  });

  skipWarmUpCheck.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      action: MSG_ACTION.SET_PREFERENCE,
      updates: { skipWarmUp: skipWarmUpCheck.checked },
    });
    flashSaved();
  });

  disableNotificationsCheck.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      action: MSG_ACTION.SET_PREFERENCE,
      updates: { disableNotifications: disableNotificationsCheck.checked },
    });
    flashSaved();
  });

  debugCheck.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      action: MSG_ACTION.SET_PREFERENCE,
      updates: { debugMode: debugCheck.checked },
    });
    flashSaved();
  });
}
