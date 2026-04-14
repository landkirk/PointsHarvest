import { MSG_ACTION } from '../util/messaging.js';
import { KEEPALIVE_PORT } from '../util/config.js';
import type { AppMessage, PhaseKey, PhaseProgressMap } from '../util/messaging.js';
import { PHASE, PHASE_TIME_LABEL } from '../util/persistent-state.js';
import type { RunState, UserPreferences, PhasePointsMap } from '../util/persistent-state.js';
import { SCREENS, UPDATE_SCREEN } from '../util/screens.js';
import { showOnboarding } from './onboarding.js';
import { checkForUpdate } from '../util/update-check.js';
import { renderDebug, appendLogEntry } from './debug-panel.js';
import { renderFailures, appendFailure } from './failure-banner.js';
import { renderPrefs, bindPrefs, getSkipWarmUp, getDebugMode } from './prefs-panel.js';

// ── DOM refs ────────────────────────────────────────────────────────────────

const dot = document.getElementById('dot') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const bar = document.getElementById('progress-bar') as HTMLElement;
const phaseEls: Record<PhaseKey, HTMLElement> = {
  warmup: document.getElementById('phase-warmup') as HTMLElement,
  explore: document.getElementById('phase-explore') as HTMLElement,
  daily: document.getElementById('phase-daily') as HTMLElement,
  farm: document.getElementById('phase-farm') as HTMLElement,
};
const phaseCountEls: Record<PhaseKey, HTMLElement> = {
  warmup: phaseEls.warmup.querySelector('.phase-count') as HTMLElement,
  explore: phaseEls.explore.querySelector('.phase-count') as HTMLElement,
  daily: phaseEls.daily.querySelector('.phase-count') as HTMLElement,
  farm: phaseEls.farm.querySelector('.phase-count') as HTMLElement,
};
const phaseBarEls: Record<PhaseKey, HTMLElement> = {
  warmup: phaseEls.warmup.querySelector('.phase-bar') as HTMLElement,
  explore: phaseEls.explore.querySelector('.phase-bar') as HTMLElement,
  daily: phaseEls.daily.querySelector('.phase-bar') as HTMLElement,
  farm: phaseEls.farm.querySelector('.phase-bar') as HTMLElement,
};
const totalPtsEl = document.getElementById('total-pts') as HTMLElement;
const phaseEarnedEls: Record<PhaseKey, HTMLElement> = {
  warmup: phaseEls.warmup.querySelector('.phase-earned') as HTMLElement,
  explore: phaseEls.explore.querySelector('.phase-earned') as HTMLElement,
  daily: phaseEls.daily.querySelector('.phase-earned') as HTMLElement,
  farm: phaseEls.farm.querySelector('.phase-earned') as HTMLElement,
};

function phaseEarnedLabel(phase: PhaseKey, pts: number): string {
  return `+${pts} pts ${PHASE_TIME_LABEL[phase]}`;
}

let prevPhasePoints: Partial<PhasePointsMap> = {};
let phasePointsInitialized = false;

function showPointsToast(phase: PhaseKey, delta: number): void {
  const row = phaseEls[phase];
  const toast = document.createElement('div');
  toast.className = 'points-toast';
  toast.textContent = `+${delta} pts`;
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
  row.appendChild(toast);
}

const mainEl = document.getElementById('main') as HTMLElement;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLElement;
const btnDone = document.getElementById('btn-done') as HTMLElement;
const debugPanel = document.getElementById('debug-panel') as HTMLElement;
const btnPurge = document.getElementById('btn-purge') as HTMLElement;
const btnDashboard = document.getElementById('btn-dashboard') as HTMLAnchorElement;

// ── Main UI ────────────────────────────────────────────────────────────────

function hasAnyPhases(phases: PhaseProgressMap | null | undefined): boolean {
  return !!phases && Object.values(phases).some((p) => p !== null);
}

function renderPhasePoints(phasePoints: Partial<PhasePointsMap> | null | undefined): void {
  for (const key of Object.values(PHASE) as PhaseKey[]) {
    const pts = phasePoints?.[key] ?? 0;
    phaseEarnedEls[key].textContent = pts > 0 ? phaseEarnedLabel(key, pts) : '';
    const delta = pts - (prevPhasePoints[key] ?? 0);
    if (phasePointsInitialized && delta > 0) {
      showPointsToast(key, delta);
    }
  }
  prevPhasePoints = { ...(phasePoints ?? {}) };
  phasePointsInitialized = true;
  const weekPts = phasePoints?.explore ?? 0;
  const todayPts = (phasePoints?.daily ?? 0) + (phasePoints?.farm ?? 0);
  if (weekPts > 0 && todayPts > 0) {
    totalPtsEl.textContent = `+${weekPts} explore (wk) · +${todayPts} today`;
  } else if (weekPts > 0) {
    totalPtsEl.textContent = `+${weekPts} explore (wk)`;
  } else if (todayPts > 0) {
    totalPtsEl.textContent = `+${todayPts} today`;
  } else {
    totalPtsEl.textContent = '';
  }
}

function renderPhases(phases: PhaseProgressMap | null | undefined, activePhase?: PhaseKey): void {
  for (const key of Object.values(PHASE) as PhaseKey[]) {
    const el = phaseEls[key];
    const p = phases?.[key] ?? null;
    const isDone = p !== null && p.done >= p.total && p.total > 0;
    const isActive = activePhase === key;
    el.classList.toggle('done', isDone);
    el.classList.toggle('active', isActive && !isDone);

    if (p) {
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
      phaseCountEls[key].textContent = `${p.done}/${p.total}`;
      phaseBarEls[key].style.width = pct + '%';
    } else {
      phaseCountEls[key].textContent = '';
      phaseBarEls[key].style.width = '0%';
    }
  }
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
  const { headerMessage, activePhase, phases, phasePoints } = header;

  const activeProgress = activePhase ? (phases?.[activePhase] ?? null) : null;
  const completed = activeProgress?.done ?? 0;
  const total = activeProgress?.total ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isDone = !isRunning && hasAnyPhases(phases);

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

  renderPhases(phases, activePhase ?? undefined);
  renderPhasePoints(phasePoints);
  renderFailures(run.failures ?? []);
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
