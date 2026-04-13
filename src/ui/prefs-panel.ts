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
const speedButtonsContainer = document.getElementById('speed-buttons') as HTMLElement;
const speedButtons = Array.from(
  speedButtonsContainer.querySelectorAll<HTMLButtonElement>('.speed-btn'),
);
const speedDescEl = document.getElementById('speed-desc') as HTMLElement;

const SPEED_DESCRIPTIONS: Record<number, string> = {
  0.6: 'Shorter pauses between actions. Runs complete faster but are more likely to be flagged.',
  1: 'Balanced pacing. A good starting point for most accounts.',
  4: 'Longer pauses between actions. Takes more time but mimics human browsing more closely.',
  8: 'Maximum delay between every action. Lowest detection risk — runs may take significantly longer.',
};

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

function setActiveSpeedButton(multiplier: number): void {
  for (const btn of speedButtons) {
    btn.classList.toggle('active', Number(btn.dataset.multiplier) === multiplier);
  }
  speedDescEl.textContent = SPEED_DESCRIPTIONS[multiplier] ?? '';
}

/** Sync checkbox states from a freshly-loaded UserPreferences object. */
export function renderPrefs(prefs: UserPreferences): void {
  skipWarmUpCheck.checked = prefs.skipWarmUp;
  disableNotificationsCheck.checked = prefs.disableNotifications;
  debugCheck.checked = prefs.debugMode;
  setActiveSpeedButton(prefs.timingMultiplier ?? 1.0);
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

  for (const btn of speedButtons) {
    btn.addEventListener('click', () => {
      const multiplier = Number(btn.dataset.multiplier);
      setActiveSpeedButton(multiplier);
      chrome.runtime.sendMessage({
        action: MSG_ACTION.SET_PREFERENCE,
        updates: { timingMultiplier: multiplier },
      });
      flashSaved();
    });
  }
}
