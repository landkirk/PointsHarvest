import { MSG_ACTION } from '../util/messaging.js';
import type { AppMessage, PhaseKey, PhaseProgressMap } from '../util/messaging.js';
import { PHASE, PHASE_TIME_LABEL, setState } from '../util/state.js';
import type { AppState, PhasePointsMap } from '../util/state.js';
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
const phaseRowsEl = document.getElementById('phase-rows') as HTMLElement;
const phaseEls: Record<PhaseKey, HTMLElement> = {
  explore: document.getElementById('phase-explore') as HTMLElement,
  daily: document.getElementById('phase-daily') as HTMLElement,
  farm: document.getElementById('phase-farm') as HTMLElement,
};
const phaseCountEls: Record<PhaseKey, HTMLElement> = {
  explore: phaseEls.explore.querySelector('.phase-count') as HTMLElement,
  daily: phaseEls.daily.querySelector('.phase-count') as HTMLElement,
  farm: phaseEls.farm.querySelector('.phase-count') as HTMLElement,
};
const phaseBarEls: Record<PhaseKey, HTMLElement> = {
  explore: phaseEls.explore.querySelector('.phase-bar') as HTMLElement,
  daily: phaseEls.daily.querySelector('.phase-bar') as HTMLElement,
  farm: phaseEls.farm.querySelector('.phase-bar') as HTMLElement,
};
const totalPtsEl = document.getElementById('total-pts') as HTMLElement;
const phaseEarnedEls: Record<PhaseKey, HTMLElement> = {
  explore: phaseEls.explore.querySelector('.phase-earned') as HTMLElement,
  daily: phaseEls.daily.querySelector('.phase-earned') as HTMLElement,
  farm: phaseEls.farm.querySelector('.phase-earned') as HTMLElement,
};

function phaseEarnedLabel(phase: PhaseKey, pts: number): string {
  return `+${pts} pts ${PHASE_TIME_LABEL[phase]}`;
}

const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLElement;
const btnDone = document.getElementById('btn-done') as HTMLElement;
const skipWarmUpCheck = document.getElementById('skip-warmup-check') as HTMLInputElement;
const debugCheck = document.getElementById('debug-check') as HTMLInputElement;
const debugPanel = document.getElementById('debug-panel') as HTMLElement;
const btnPurge = document.getElementById('btn-purge') as HTMLElement;

// ── Main UI ────────────────────────────────────────────────────────────────

interface RenderState {
  isRunning?: boolean;
  isLingering?: boolean;
  headerMessage?: string;
  activePhase?: PhaseKey | null;
  phases?: PhaseProgressMap | null;
  phasePoints?: Partial<PhasePointsMap> | null;
}

function hasAnyPhases(phases: PhaseProgressMap | null | undefined): boolean {
  return !!phases && Object.values(phases).some((p) => p !== null);
}

function renderPhasePoints(phasePoints: Partial<PhasePointsMap> | null | undefined): void {
  for (const key of Object.values(PHASE) as PhaseKey[]) {
    const pts = phasePoints?.[key] ?? 0;
    phaseEarnedEls[key].textContent = pts > 0 ? phaseEarnedLabel(key, pts) : '';
  }
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
  phaseRowsEl.classList.toggle('visible', hasAnyPhases(phases));

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

function render({
  isRunning,
  isLingering,
  headerMessage,
  activePhase,
  phases,
  phasePoints,
}: RenderState): void {
  const activeProgress = activePhase ? (phases?.[activePhase] ?? null) : null;
  const completed = activeProgress?.done ?? 0;
  const total = activeProgress?.total ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isDone = !isRunning && hasAnyPhases(phases);

  statusEl.textContent = headerMessage || 'Idle';
  bar.style.width = pct + '%';
  labelEl.textContent = total > 0 ? `${completed} / ${total}` : '—';

  dot.className = 'dot';
  if (isLingering) dot.classList.add('waiting');
  else if (isRunning) dot.classList.add('running');
  else if (isDone) dot.classList.add('done');

  btnStart.disabled = !!isRunning;
  btnStop.style.display = isRunning ? 'block' : 'none';
  btnDone.style.display = isLingering ? 'block' : 'none';

  renderPhases(phases, activePhase ?? undefined);
  renderPhasePoints(phasePoints);
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
          const stoppedHeader = { ...state.header, headerMessage: 'Stopped', activePhase: null };
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
      headerMessage: msg.headerMessage,
      activePhase: msg.activePhase,
      phases: msg.phases,
      phasePoints: msg.phasePoints,
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
      headerMessage: 'Action required — complete the activity in the tab',
    });
  }
});

// ── Button listeners ────────────────────────────────────────────────────────

btnStart.addEventListener('click', () => {
  btnStart.disabled = true;
  chrome.runtime.sendMessage({ action: MSG_ACTION.START, skipWarmUp: skipWarmUpCheck.checked });
  render({ isRunning: true, headerMessage: 'Starting…', activePhase: null, phases: { explore: null, daily: null, farm: null } });
  renderFailures([]);
  if (debugCheck.checked) clearDebug();
});

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: MSG_ACTION.STOP });
  render({ isRunning: false, headerMessage: 'Stopped' });
});

btnDone.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: MSG_ACTION.USER_ACTION_COMPLETE });
  render({ isRunning: true, isLingering: false, headerMessage: 'Resuming…' });
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
