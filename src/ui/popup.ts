import { MSG_ACTION } from '../util/messaging.js';
import { KEEPALIVE_PORT } from '../util/config.js';
import type { AppMessage } from '../util/messaging.js';
import { PHASE_KEYS, PHASES_BY_KEY } from '../util/phase.js';
import type { PhaseKey, PhaseStates } from '../util/phase.js';
import type { RunState, UserPreferences } from '../util/persistent-state.js';
import { SCREENS, UPDATE_SCREEN } from '../util/screens.js';
import { showOnboarding } from './onboarding.js';
import { checkForUpdate } from '../util/update-check.js';
import { renderDebug, appendLogEntry } from './debug-panel.js';
import { renderActionBanner, renderFailures, appendFailure } from './failure-banner.js';
import { renderPrefs, bindPrefs, getSkipWarmUp, getDebugMode } from './prefs-panel.js';
import { renderRunSummary } from './run-summary-card.js';

// ── DOM refs ────────────────────────────────────────────────────────────────

const dot = document.getElementById('dot') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const bar = document.getElementById('progress-bar') as HTMLElement;
const phaseEls = {} as Record<PhaseKey, HTMLElement>;
const phaseCountEls = {} as Record<PhaseKey, HTMLElement>;
const phaseBarEls = {} as Record<PhaseKey, HTMLElement>;
const phaseEarnedEls = {} as Record<PhaseKey, HTMLElement>;
for (const key of PHASE_KEYS) {
  const row = document.getElementById(`phase-${key}`) as HTMLElement;
  phaseEls[key] = row;
  phaseCountEls[key] = row.querySelector('.phase-count') as HTMLElement;
  phaseBarEls[key] = row.querySelector('.phase-bar') as HTMLElement;
  phaseEarnedEls[key] = row.querySelector('.phase-earned') as HTMLElement;
}

function phaseEarnedLabel(phase: PhaseKey, pts: number): string {
  return `+${pts} pts ${PHASES_BY_KEY[phase].timeLabel}`;
}

let prevPhasePoints: Partial<Record<PhaseKey, number>> = {};
let phasePointsInitialized = false;
let wasRunning = false;

const animHandles: Partial<Record<PhaseKey, number>> = {};
const animDisplayed: Partial<Record<PhaseKey, number>> = {};

function stopPhaseAnim(phase: PhaseKey): void {
  const handle = animHandles[phase];
  if (handle !== undefined) cancelAnimationFrame(handle);
  animHandles[phase] = undefined;
  phaseEarnedEls[phase].classList.remove('earning');
}

function animatePhaseEarned(phase: PhaseKey, from: number, to: number): void {
  const el = phaseEarnedEls[phase];
  const handle = animHandles[phase];
  if (handle !== undefined) cancelAnimationFrame(handle);

  const duration = 650;
  const start = performance.now();
  el.classList.add('earning');

  const tick = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const current = Math.round(from + (to - from) * eased);
    animDisplayed[phase] = current;
    el.textContent = phaseEarnedLabel(phase, current);
    if (t < 1) {
      animHandles[phase] = requestAnimationFrame(tick);
    } else {
      stopPhaseAnim(phase);
    }
  };
  animHandles[phase] = requestAnimationFrame(tick);
}

const phaseRowsEl = document.getElementById('phase-rows') as HTMLElement;
const mainEl = document.getElementById('main') as HTMLElement;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLElement;
const btnDone = document.getElementById('btn-done') as HTMLElement;
const debugPanel = document.getElementById('debug-panel') as HTMLElement;
const btnPurge = document.getElementById('btn-purge') as HTMLElement;
const btnDashboard = document.getElementById('btn-dashboard') as HTMLAnchorElement;

// ── Main UI ────────────────────────────────────────────────────────────────

function hasAnyProgress(phaseStates: PhaseStates | null | undefined): boolean {
  return !!phaseStates && Object.values(phaseStates).some((s) => s.progress !== null);
}

function renderPhaseStates(
  phaseStates: PhaseStates | null | undefined,
  activePhase: PhaseKey | undefined,
): void {
  for (const key of PHASE_KEYS) {
    const state = phaseStates?.[key] ?? null;
    const progress = state?.progress ?? null;
    const points = state?.points ?? 0;

    const el = phaseEls[key];
    const isDone = progress !== null && progress.done >= progress.total && progress.total > 0;
    const isActive = activePhase === key;
    el.classList.toggle('done', isDone);
    el.classList.toggle('active', isActive && !isDone);

    if (progress) {
      const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
      phaseCountEls[key].textContent = `${progress.done}/${progress.total}`;
      phaseBarEls[key].style.width = pct + '%';
    } else {
      phaseCountEls[key].textContent = '';
      phaseBarEls[key].style.width = '0%';
    }

    const prev = prevPhasePoints[key] ?? 0;
    const delta = points - prev;
    if (phasePointsInitialized && delta > 0) {
      const from = animHandles[key] !== undefined ? (animDisplayed[key] ?? prev) : prev;
      animatePhaseEarned(key, from, points);
    } else if (animHandles[key] === undefined) {
      phaseEarnedEls[key].textContent = points > 0 ? phaseEarnedLabel(key, points) : '';
    }
    prevPhasePoints[key] = points;
  }
  phasePointsInitialized = true;
}

async function render(): Promise<void> {
  const [run, prefs] = await Promise.all([
    chrome.runtime.sendMessage({ action: MSG_ACTION.GET_RUN_STATE }) as Promise<RunState | null>,
    chrome.runtime.sendMessage({
      action: MSG_ACTION.GET_PREFERENCES,
    }) as Promise<UserPreferences | null>,
  ]);
  if (!run || !prefs) {
    statusEl.textContent = 'Reconnecting…';
    btnStart.disabled = true;
    return;
  }
  const { isRunning, isLingering, header } = run;
  const { headerMessage, activePhase, phaseStates } = header;

  const activeProgress = activePhase ? (phaseStates?.[activePhase]?.progress ?? null) : null;
  const completed = activeProgress?.done ?? 0;
  const total = activeProgress?.total ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isDone = !isRunning && hasAnyProgress(phaseStates);

  renderPrefs(prefs);
  debugPanel.classList.toggle('open', prefs.debugMode);
  statusEl.textContent = headerMessage || 'Idle';
  bar.style.width = pct + '%';

  dot.className = 'dot';
  if (isLingering) dot.classList.add('waiting');
  else if (isRunning) dot.classList.add('running');
  else if (isDone) dot.classList.add('done');

  btnStart.disabled = !!isRunning;
  btnStop.style.display = isRunning ? 'block' : 'none';
  btnDone.style.display = isLingering ? 'block' : 'none';

  if (isRunning && !wasRunning) {
    prevPhasePoints = {};
    phasePointsInitialized = false;
    for (const key of PHASE_KEYS) {
      stopPhaseAnim(key);
      animDisplayed[key] = undefined;
    }
  }
  wasRunning = !!isRunning;

  const summary = isRunning ? null : run.lastRunSummary;
  phaseRowsEl.style.display = summary ? 'none' : '';
  if (!summary) {
    renderPhaseStates(phaseStates, activePhase ?? undefined);
  }
  renderRunSummary(summary);
  renderActionBanner(run.activeUserAction ?? null);
  renderFailures(run.failures ?? [], run.activeUserAction?.failureCategory);
  if (getDebugMode()) {
    renderDebug(run);
  }
}

// Load state on open. If storage says running, ping to confirm the service worker
// is actually alive and running — if it was restarted, isActivelyRunning is false
// and we reset rather than showing a permanently-stuck running state.
async function initPopup(): Promise<void> {
  mainEl.style.display = '';
  const run = (await chrome.runtime.sendMessage({
    action: MSG_ACTION.GET_RUN_STATE,
  })) as RunState | null;
  if (!run) return;
  if (run.isRunning) {
    const response = (await chrome.runtime.sendMessage({
      action: MSG_ACTION.PING,
    })) as { running: boolean };
    if (!response?.running) {
      await chrome.runtime.sendMessage({ action: MSG_ACTION.RESET_STALE });
    }
  }
  await render();
}

function showPendingOrInit(prefs: UserPreferences): void {
  const seen = new Set(prefs.seenScreenIds ?? []);
  const pending = SCREENS.filter((s) => !seen.has(s.id));
  if (pending.length > 0) {
    showOnboarding(pending, initPopup);
  } else {
    void initPopup();
  }
}

Promise.all([
  chrome.runtime.sendMessage({
    action: MSG_ACTION.GET_PREFERENCES,
  }) as Promise<UserPreferences | null>,
  checkForUpdate(),
]).then(async ([prefs, updateResult]) => {
  if (!prefs) {
    void initPopup();
    return;
  }
  const updateStatusEl = document.getElementById('update-status') as HTMLElement;
  if (updateResult === null) {
    updateStatusEl.textContent = 'Update check failed or timed out';
  } else if (updateResult.hasUpdate) {
    updateStatusEl.textContent =
      prefs.ignoredUpdateVersion === updateResult.latestVersion
        ? `Update v${updateResult.latestVersion} ignored`
        : `Update available: v${updateResult.latestVersion} (installed: v${updateResult.installedVersion})`;
  } else {
    updateStatusEl.textContent = `Up to date: v${updateResult.installedVersion}`;
  }
  if (updateResult?.hasUpdate && prefs.ignoredUpdateVersion !== updateResult.latestVersion) {
    let ignoreChecked = false;
    const onIgnoreChange = (e: Event) => {
      if ((e.target as HTMLElement).id === 'ignore-update-checkbox')
        ignoreChecked = (e.target as HTMLInputElement).checked;
    };
    document.addEventListener('change', onIgnoreChange);
    showOnboarding([UPDATE_SCREEN], () => {
      document.removeEventListener('change', onIgnoreChange);
      if (ignoreChecked)
        chrome.runtime.sendMessage({
          action: MSG_ACTION.SET_PREFERENCE,
          updates: { ignoredUpdateVersion: updateResult.latestVersion },
        });
      showPendingOrInit(prefs);
    });
  } else {
    showPendingOrInit(prefs);
  }
});

// ── Message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: AppMessage): undefined => {
  if (msg.action === MSG_ACTION.PROGRESS) {
    void render();
  }
  if (msg.action === MSG_ACTION.DEBUG_ENTRY && getDebugMode()) {
    appendLogEntry(msg.entry);
  }
  if (msg.action === MSG_ACTION.FAILURE_ENTRY) {
    appendFailure(msg.failure);
  }
});

// ── Button listeners ────────────────────────────────────────────────────────

btnStart.addEventListener('click', () => {
  btnStart.disabled = true;
  chrome.windows
    .getCurrent()
    .then((win) => {
      if (!win.id) {
        btnStart.disabled = false;
        return;
      }
      chrome.runtime
        .sendMessage({
          action: MSG_ACTION.START,
          skipWarmUp: getSkipWarmUp(),
          windowId: win.id,
        })
        .catch(() => {
          btnStart.disabled = false;
        });
    })
    .catch(() => {
      btnStart.disabled = false;
    });
});

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: MSG_ACTION.STOP });
});

btnDone.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: MSG_ACTION.USER_ACTION_COMPLETE });
});

btnPurge.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: MSG_ACTION.PURGE }).then(() => {
    statusEl.textContent = 'Purged';
    setTimeout(() => void render(), 1500);
  });
});

btnDashboard.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://rewards.bing.com/?t=1' }).catch(() => {
    /* non-critical: user can open dashboard manually */
  });
});

for (const [id, path] of [
  ['link-terms', '/terms.html'],
  ['link-privacy', '/privacy.html'],
  ['link-contact', '/contact.html'],
] as const) {
  document.getElementById(id)!.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `https://pointsharvest.com${path}` }).catch(() => {});
  });
}

// ── Service worker keepalive ───────────────────────────────────────────────
// A long-lived port prevents Chrome from killing the service worker while the
// side panel is open.  A heartbeat every 20s guards against Chrome's 30s port
// idle timeout.

let keepalivePort: chrome.runtime.Port | null = null;
let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

function connectKeepalive(): void {
  keepalivePort = chrome.runtime.connect(undefined, { name: KEEPALIVE_PORT });
  keepalivePort.onDisconnect.addListener(() => {
    keepalivePort = null;
    if (keepaliveInterval) clearInterval(keepaliveInterval);
    keepaliveInterval = null;
    // Extension context invalidated — stop reconnecting.
    if (chrome.runtime.id === undefined) return;
    // Reconnect after a brief delay — the disconnect may be a transient worker restart.
    setTimeout(connectKeepalive, 1_000);
  });
  if (keepaliveInterval) clearInterval(keepaliveInterval);
  keepaliveInterval = setInterval(() => {
    keepalivePort?.postMessage({ type: 'heartbeat' });
  }, 20_000);
}

connectKeepalive();
bindPrefs();

// ── Debug panel section collapse ────────────────────────────────────────────

document.querySelectorAll('.dbg-section h2').forEach((h2) => {
  h2.addEventListener('click', () =>
    (h2.closest('.dbg-section') as HTMLElement).classList.toggle('collapsed'),
  );
});
