import { MSG_ACTION } from '../util/messaging.js';
import type { UserPreferences } from '../util/persistent-state.js';

// ── DOM refs ────────────────────────────────────────────────────────────────

const skipWarmUpCheck = document.getElementById('skip-warmup-check') as HTMLInputElement;
const disableNotificationsCheck = document.getElementById(
  'disable-notifications-check',
) as HTMLInputElement;

// ── Public API ──────────────────────────────────────────────────────────────

export function getSkipWarmUp(): boolean {
  return skipWarmUpCheck.checked;
}

/** Sync checkbox states from a freshly-loaded UserPreferences object. */
export function renderPrefs(prefs: UserPreferences): void {
  skipWarmUpCheck.checked = prefs.skipWarmUp;
  disableNotificationsCheck.checked = prefs.disableNotifications;
}

/** Attach change listeners. Call once at startup. */
export function bindPrefs(): void {
  skipWarmUpCheck.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      action: MSG_ACTION.SET_PREFERENCE,
      updates: { skipWarmUp: skipWarmUpCheck.checked },
    });
  });

  disableNotificationsCheck.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      action: MSG_ACTION.SET_PREFERENCE,
      updates: { disableNotifications: disableNotificationsCheck.checked },
    });
  });
}
