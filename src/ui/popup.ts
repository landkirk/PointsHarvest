import { MSG_ACTION } from '../util/messaging.js';
import type { AppMessage } from '../util/messaging.js';
import { setState } from '../util/state.js';
import type { AppState } from '../util/state.js';
import { SCREENS, UPDATE_SCREEN } from '../util/screens.js';
import { showOnboarding } from './onboarding.js';
import { checkForUpdate } from '../util/update-check.js';
import {
  renderDebug,
  clearDebug,
  appendLogEntry,
  renderActivitiesAndCounters,
} from './debug-panel.js';
import { renderFailures, appendFailure } from './failure-banner.js';

// ── DOM refs ────────────────────────────────────────────────────────────────

const dot = document.getElementById('dot') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const bar = document.getElementById('progress-bar') as HTMLElement;
const labelEl = document.getElementById('progress-label') as HTMLElement;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLElement;
const btnDone = document.getElementById('btn-done') as HTMLElement;
const lastSearch = document.getElementById('last-search') as HTMLElement;
const skipWarmUpCheck = document.getElementById('skip-warmup-check') as HTMLInputElement;
const debugCheck = document.getElementById('debug-check') as HTMLInputElement;
const debugPanel = document.getElementById('debug-panel') as HTMLElement;
const btnPurge = document.getElementById('btn-purge') as HTMLElement;

// ── Main UI ────────────────────────────────────────────────────────────────

interface RenderState {
  isRunning?: boolean;
  isLingering?: boolean;
  status?: string;
  completedSearches?: number;
  totalSearches?: number;
  lastSearchString?: string;
}

function render({
  isRunning,
  isLingering,
  status,
  completedSearches,
  totalSearches,
  lastSearchString,
}: RenderState): void {
  const completed = completedSearches || 0;
  const total = totalSearches || 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isDone = !isRunning && completed > 0 && completed >= total && total > 0;

  statusEl.textContent = status || 'Idle';
  bar.style.width = pct + '%';
  labelEl.textContent = total > 0 ? `${completed} / ${total} searches` : '—';
  lastSearch.textContent = lastSearchString ? `Last: ${lastSearchString}` : '';

  dot.className = 'dot';
  if (isLingering) dot.classList.add('waiting');
  else if (isRunning) dot.classList.add('running');
  else if (isDone) dot.classList.add('done');

  btnStart.disabled = !!isRunning;
  btnStop.style.display = isRunning ? 'block' : 'none';
  btnDone.style.display = isLingering ? 'block' : 'none';
}

// Load state on open. If storage says running, ping to confirm the service worker
// is actually alive and running — if it was restarted, isActivelyRunning is false
// and we reset rather than showing a permanently-stuck running state.
function renderState(state: AppState): void {
  skipWarmUpCheck.checked = state.skipWarmUp;
  render({ ...state, ...state.header });
  renderFailures(state.failures ?? []);
  if (debugCheck.checked) renderDebug(state);
}

const mainEl = document.getElementById('main') as HTMLElement;

function initPopup(): void {
  mainEl.style.display = '';
  chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }).then((state: AppState) => {
    if (!state) return;
    if (!state.isRunning) {
      renderState(state);
      return;
    }
    chrome.runtime
      .sendMessage({ action: MSG_ACTION.PING })
      .then((response: { running: boolean }) => {
        if (!response?.running) {
          const stoppedHeader = { ...state.header, status: 'Stopped' };
          chrome.storage.local.set({ isRunning: false, header: stoppedHeader });
          state = { ...state, isRunning: false, header: stoppedHeader };
        }
        renderState(state);
      });
  });
}

function showPendingOrInit(state: AppState): void {
  const seen = new Set(state.seenScreenIds ?? []);
  const pending = SCREENS.filter((s) => !seen.has(s.id));
  if (pending.length > 0) {
    showOnboarding(pending, initPopup);
  } else {
    initPopup();
  }
}

Promise.all([
  chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }) as Promise<AppState>,
  checkForUpdate(),
]).then(async ([state, updateResult]) => {
  if (!state) {
    initPopup();
    return;
  }
  const updateStatusEl = document.getElementById('update-status') as HTMLElement;
  if (updateResult === null) {
    updateStatusEl.textContent = 'Update check failed or timed out';
  } else if (updateResult.hasUpdate) {
    updateStatusEl.textContent =
      state.ignoredUpdateVersion === updateResult.latestVersion
        ? `Update v${updateResult.latestVersion} ignored`
        : `Update available: v${updateResult.latestVersion} (installed: v${updateResult.installedVersion})`;
  } else {
    updateStatusEl.textContent = `Up to date: v${updateResult.installedVersion}`;
  }
  if (updateResult?.hasUpdate && state.ignoredUpdateVersion !== updateResult.latestVersion) {
    let ignoreChecked = false;
    const onIgnoreChange = (e: Event) => {
      if ((e.target as HTMLElement).id === 'ignore-update-checkbox')
        ignoreChecked = (e.target as HTMLInputElement).checked;
    };
    document.addEventListener('change', onIgnoreChange);
    showOnboarding([UPDATE_SCREEN], () => {
      document.removeEventListener('change', onIgnoreChange);
      if (ignoreChecked) setState({ ignoredUpdateVersion: updateResult.latestVersion });
      showPendingOrInit(state);
    });
  } else {
    showPendingOrInit(state);
  }
});

// ── Message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: AppMessage): undefined => {
  if (msg.action === MSG_ACTION.PROGRESS) {
    render({
      isRunning: true,
      status: msg.status,
      completedSearches: msg.completedSearches,
      totalSearches: msg.totalSearches,
      lastSearchString: msg.lastSearchString,
    });
  }
  if (msg.action === MSG_ACTION.COMPLETE) {
    chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }).then((state: AppState) => {
      if (state) renderState(state);
    });
  }
  if (msg.action === MSG_ACTION.ACTIVITIES_MAPPED && debugCheck.checked) {
    chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }).then((state: AppState) => {
      if (state) renderActivitiesAndCounters(state);
    });
  }
  if (msg.action === MSG_ACTION.DEBUG_ENTRY && debugCheck.checked) {
    appendLogEntry(msg.entry);
  }
  if (msg.action === MSG_ACTION.FAILURE_ENTRY) {
    appendFailure(msg.failure);
  }
  if (msg.action === MSG_ACTION.LINGER_WAITING) {
    render({
      isRunning: true,
      isLingering: true,
      status: 'Action required — complete the activity in the tab',
    });
  }
});

// ── Button listeners ────────────────────────────────────────────────────────

btnStart.addEventListener('click', () => {
  btnStart.disabled = true;
  chrome.runtime.sendMessage({ action: MSG_ACTION.START, skipWarmUp: skipWarmUpCheck.checked });
  render({ isRunning: true, status: 'Starting…', completedSearches: 0, totalSearches: 0 });
  renderFailures([]);
  if (debugCheck.checked) clearDebug();
});

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: MSG_ACTION.STOP });
  render({ isRunning: false, status: 'Stopped' });
});

btnDone.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: MSG_ACTION.USER_ACTION_COMPLETE });
  render({ isRunning: true, isLingering: false, status: 'Resuming…' });
});

btnPurge.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: MSG_ACTION.PURGE }).then(() => window.close());
});

// ── Debug panel toggle ──────────────────────────────────────────────────────

document.querySelectorAll('.dbg-section h2').forEach((h2) => {
  h2.addEventListener('click', () =>
    (h2.closest('.dbg-section') as HTMLElement).classList.toggle('collapsed'),
  );
});

skipWarmUpCheck.addEventListener('change', () => {
  chrome.storage.local.set({ skipWarmUp: skipWarmUpCheck.checked });
});

debugCheck.addEventListener('change', () => {
  debugPanel.classList.toggle('open', debugCheck.checked);
  if (debugCheck.checked) {
    chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }).then((state: AppState) => {
      if (state) renderDebug(state);
    });
  }
});
