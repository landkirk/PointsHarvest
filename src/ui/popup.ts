import { MSG_ACTION } from '../util/messaging.js';
import { CardState } from '../util/activity.js';
import { PC_SEARCH_TYPE, setState } from '../util/state.js';
import type { AppState, SearchCounter } from '../util/state.js';
import type { ActivityScan, DebugEntry } from '../util/debug.js';
import type { Failure } from '../util/failures.js';
import type { MappedActivity } from '../util/activity.js';
import { SCREENS, UPDATE_SCREEN } from '../util/screens.js';
import { showOnboarding } from './onboarding.js';
import { checkForUpdate } from '../util/update-check.js';

// ── Generic activity debug view ─────────────────────────────────────────────

interface ActivityDebugItem {
  title: string;
  description?: string;
  skipReason?: CardState | null;
  action?: string;
}

interface ActivityDebugData {
  stats?: { total: number; actionable: number; locked: number; completed: number };
  items: ActivityDebugItem[];
  emptyMessage: string;
  queue?: string[];
}

const dot = document.getElementById('dot')!;
const statusEl = document.getElementById('status')!;
const bar = document.getElementById('progress-bar') as HTMLElement;
const labelEl = document.getElementById('progress-label')!;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLElement;
const btnDone = document.getElementById('btn-done') as HTMLElement;
const lastSearch = document.getElementById('last-search')!;
const skipWarmUpCheck = document.getElementById('skip-warmup-check') as HTMLInputElement;
const debugCheck = document.getElementById('debug-check') as HTMLInputElement;
const debugPanel = document.getElementById('debug-panel')!;
const btnPurge = document.getElementById('btn-purge')!;
const dbgWarmUp = document.getElementById('dbg-warmup')!;
const dbgExplore = document.getElementById('dbg-explore')!;
const dbgDaily = document.getElementById('dbg-daily')!;
const dbgPcCounters = document.getElementById('dbg-pc-counters')!;
const dbgLog = document.getElementById('dbg-log')!;
const setupBanner = document.getElementById('setup-banner')!;
const btnOpenSettings = document.getElementById('btn-open-settings') as HTMLButtonElement;
const failureBanner = document.getElementById('failure-banner')!;
const failureSummary = document.getElementById('failure-summary')!;
const failureList = document.getElementById('failure-list')!;

// ── Setup warning banner ────────────────────────────────────────────────────

btnOpenSettings.addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://settings/content/popups' }).catch(() => {});
});

// ── Failure banner ─────────────────────────────────────────────────────────

let failureListExpanded = false;

function updateFailureSummary(count: number): void {
  failureSummary.textContent = `${count} failure${count === 1 ? '' : 's'} — click to ${failureListExpanded ? 'collapse' : 'expand'}`;
}

function renderFailures(failures: Failure[]): void {
  if (!failures || failures.length === 0) {
    failureBanner.style.display = 'none';
    setupBanner.style.display = 'none';
    failureList.innerHTML = '';
    return;
  }
  let hasSetup = false;
  const nonSetup = failures.filter((f) => {
    if (f.category === 'setup') {
      hasSetup = true;
      return false;
    }
    return true;
  });
  if (hasSetup) setupBanner.style.display = 'block';
  if (nonSetup.length === 0) {
    failureBanner.style.display = 'none';
    failureList.innerHTML = '';
    return;
  }
  failureBanner.style.display = 'block';
  updateFailureSummary(nonSetup.length);
  failureList.innerHTML = nonSetup.map((f) => failureItemHtml(f)).join('');
}

function appendFailure(f: Failure): void {
  if (f.category === 'setup') {
    setupBanner.style.display = 'block';
    return;
  }
  failureBanner.style.display = 'block';
  const div = document.createElement('div');
  div.innerHTML = failureItemHtml(f);
  failureList.appendChild(div.firstElementChild!);
  updateFailureSummary(failureList.children.length);
}

function failureItemHtml(f: Failure): string {
  return `<div class="failure-item"><span class="f-time">${esc(f.time)}</span><span class="f-cat">[${esc(f.category)}]</span><span class="f-msg">${esc(f.message)}</span></div>`;
}

failureSummary.addEventListener('click', () => {
  failureListExpanded = !failureListExpanded;
  failureList.style.display = failureListExpanded ? 'block' : 'none';
  updateFailureSummary(failureList.children.length);
});

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
  const updateStatusEl = document.getElementById('update-status')!;
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

chrome.runtime.onMessage.addListener((msg): undefined => {
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
      if (state) {
        renderActivitySection(
          dbgExplore,
          exploreToActivityData(state.debug.domDebug, state.mappedActivities as MappedActivity[]),
          LIST_SIZE.LARGE,
        );
        renderActivitySection(
          dbgDaily,
          dailySetsToActivityData(state.debug.dailySetDebug),
          LIST_SIZE.MEDIUM,
        );
        renderPcCounters(state.searchCounters);
      }
    });
  }
  if (msg.action === MSG_ACTION.DEBUG_ENTRY && debugCheck.checked) {
    appendLogEntry(msg.entry as DebugEntry);
  }
  if (msg.action === MSG_ACTION.FAILURE_ENTRY) {
    appendFailure(msg.failure as Failure);
  }
  if (msg.action === MSG_ACTION.LINGER_WAITING) {
    render({
      isRunning: true,
      isLingering: true,
      status: 'Action required — complete the activity in the tab',
    });
  }
});

btnStart.addEventListener('click', () => {
  btnStart.disabled = true;
  chrome.runtime.sendMessage({ action: MSG_ACTION.START, skipWarmUp: skipWarmUpCheck.checked });
  render({ isRunning: true, status: 'Starting…', completedSearches: 0, totalSearches: 0 });
  renderFailures([]);
  setupBanner.style.display = 'none';
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

// ── Debug panel ────────────────────────────────────────────────────────────

document.querySelectorAll('.dbg-section h2').forEach((h2) => {
  h2.addEventListener('click', () => h2.closest('.dbg-section')!.classList.toggle('collapsed'));
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

function clearDebug(): void {
  dbgWarmUp.innerHTML = '<div class="dbg-empty">Run the extension to see warm-up queries.</div>';
  renderActivitySection(
    dbgExplore,
    { items: [], emptyMessage: 'Run the extension to see extraction results.' },
    LIST_SIZE.LARGE,
  );
  renderActivitySection(
    dbgDaily,
    { items: [], emptyMessage: 'Run the extension to see results.' },
    LIST_SIZE.MEDIUM,
  );
  dbgPcCounters.innerHTML = '<div class="dbg-empty">No data yet.</div>';
  dbgLog.innerHTML = '<div class="dbg-empty">No events yet.</div>';
}

function renderDebug({ debug, searchCounters, mappedActivities, warmUpQueries }: AppState): void {
  renderWarmUp(warmUpQueries);
  renderActivitySection(
    dbgExplore,
    exploreToActivityData(debug.domDebug, mappedActivities as MappedActivity[]),
    LIST_SIZE.LARGE,
  );
  renderActivitySection(dbgDaily, dailySetsToActivityData(debug.dailySetDebug), LIST_SIZE.MEDIUM);
  renderPcCounters(searchCounters);
  renderLog(debug.debugLog);
}

// ── Generic activity section renderer ──────────────────────────────────────

type ListSize = 'small' | 'medium' | 'large';
const LIST_SIZE = { SMALL: 'small', MEDIUM: 'medium', LARGE: 'large' } as const;

function renderActivitySection(
  container: HTMLElement,
  data: ActivityDebugData,
  listSize: ListSize = LIST_SIZE.LARGE,
): void {
  let html = '';

  if (data.stats) {
    const { total, actionable, locked, completed } = data.stats;
    html += `
      <div class="dom-stats">
        <span data-filter="all"                      title="Show all">${total} cards</span>
        <span data-filter="${CardState.Actionable}" title="Show actionable only">${actionable} actionable</span>
        <span data-filter="${CardState.Locked}"     title="Show locked only">${locked} locked</span>
        <span data-filter="${CardState.Completed}"  title="Show completed only">${completed} completed</span>
      </div>`;
  }

  if (data.items.length === 0) {
    html += `<div class="dbg-list dbg-list--${listSize}"><div class="dbg-empty">${esc(data.emptyMessage)}</div></div>`;
  } else {
    html +=
      `<div class="dbg-list dbg-list--${listSize}">` +
      data.items
        .map(
          (item) => `
      <div class="dbg-card" data-status="${esc(item.skipReason ?? CardState.Actionable)}">
        <div class="card-title${item.skipReason ? ' skipped' : ''}">${esc(item.title)}</div>
        ${item.description ? `<div class="card-desc">${esc(item.description)}</div>` : ''}
        ${
          item.skipReason
            ? `<div class="card-skip card-skip--${esc(item.skipReason)}">Skipped: ${esc(item.skipReason)}</div>`
            : item.action
              ? `<div class="card-query" title="${esc(item.action)}">→ ${esc(item.action)}</div>`
              : ''
        }
      </div>
    `,
        )
        .join('') +
      '</div>';
  }

  if (data.queue !== undefined) {
    html += '<div class="dbg-section-label" style="margin-top:8px">Search Queue</div>';
    html += queryListHtml(data.queue, 'Not yet built.', LIST_SIZE.SMALL);
  }

  container.innerHTML = html;

  // Attach filter delegation once per container (survives re-renders).
  if (!container.dataset.filterInit) {
    container.dataset.filterInit = '1';
    container.addEventListener('click', (e) => {
      const span = (e.target as Element).closest<HTMLElement>('[data-filter]');
      if (!span) return;
      const filter = span.dataset.filter!;
      const list = container.querySelector<HTMLElement>('.dbg-list');
      if (!list) return;

      const next = filter === 'all' || list.dataset.activeFilter === filter ? '' : filter;
      list.dataset.activeFilter = next;
      container.querySelectorAll<HTMLElement>('[data-filter]').forEach((s) => {
        s.classList.toggle('filter-active', !!next && s.dataset.filter === next);
      });
    });
  }
}

// ── Adapters: map state to ActivityDebugData ────────────────────────────────

function buildScanStats(scan: ActivityScan): {
  total: number;
  actionable: number;
  locked: number;
  completed: number;
} {
  return {
    total: scan.actionableActivities + scan.activities.length,
    actionable: scan.actionableActivities,
    locked: scan.skippedLocked,
    completed: scan.skippedCompleted,
  };
}

function exploreToActivityData(
  scan: ActivityScan | null,
  mappedActivities: MappedActivity[],
): ActivityDebugData {
  if (!scan && mappedActivities.length === 0) {
    return {
      items: [],
      emptyMessage: 'Run the extension to see extraction results.',
      queue: undefined,
    };
  }

  const items: ActivityDebugItem[] = [
    ...mappedActivities.map((a) => ({
      title: a.title || '(no title)',
      description: a.description || undefined,
      skipReason: a.unmatched ? CardState.Unknown : null,
      action: a.unmatched ? undefined : (a.query ?? undefined),
    })),
    ...(scan?.activities ?? []).map((c) => ({
      title: c.snippet,
      skipReason: c.skipReason,
    })),
  ];

  const stats = scan ? buildScanStats(scan) : undefined;

  const queue = mappedActivities.filter((m) => m.query).map((m) => m.query as string);

  return { stats, items, emptyMessage: 'No activity cards found.', queue };
}

function dailySetsToActivityData(scan: ActivityScan | null): ActivityDebugData {
  if (!scan) {
    return { items: [], emptyMessage: 'Run the extension to see results.' };
  }

  const items: ActivityDebugItem[] = scan.activities.map((t) => ({
    title: t.snippet || '(no title)',
    skipReason: t.skipReason,
  }));

  return { stats: buildScanStats(scan), items, emptyMessage: 'No daily set activities found.' };
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function queryListHtml(
  queries: string[],
  emptyMessage: string,
  size: ListSize = LIST_SIZE.LARGE,
): string {
  if (!queries || queries.length === 0) {
    return `<div class="dbg-list dbg-list--${size}"><div class="dbg-empty">${esc(emptyMessage)}</div></div>`;
  }
  return (
    `<div class="dbg-list dbg-list--${size}">` +
    queries
      .map(
        (q, i) => `
    <div class="dbg-queue-item"><span class="idx">${i + 1}.</span>${esc(q)}</div>
  `,
      )
      .join('') +
    '</div>'
  );
}

// ── Warm-Up Searches ───────────────────────────────────────────────────────

function renderWarmUp(queries: string[]): void {
  if (!queries || queries.length === 0) {
    dbgWarmUp.innerHTML = `<div class="dbg-empty">Run the extension to see warm-up queries.</div>`;
    return;
  }
  dbgWarmUp.innerHTML = queries
    .map(
      (q, i) => `
    <div class="dbg-queue-item"><span class="idx">${i + 1}.</span>${esc(q)}</div>
  `,
    )
    .join('');
}

// ── PC Search Farming ──────────────────────────────────────────────────────

function renderPcCounters(searchCounters: SearchCounter[]): void {
  if (searchCounters.length === 0) {
    dbgPcCounters.innerHTML = '<div class="dbg-empty">No data yet.</div>';
    return;
  }
  dbgPcCounters.innerHTML = searchCounters
    .map((c) => {
      const isPC = c.type.toLowerCase() === PC_SEARCH_TYPE;
      const cls = isPC ? ' class="pc-active"' : '';
      return `<span${cls} title="${esc(c.type)}">${esc(c.type)}: ${c.current}/${c.max}</span>`;
    })
    .join('');
}

// ── Event Log ──────────────────────────────────────────────────────────────

function renderLog(debugLog: DebugEntry[]): void {
  if (!debugLog || debugLog.length === 0) {
    dbgLog.innerHTML = '<div class="dbg-empty">No events yet.</div>';
    return;
  }
  dbgLog.innerHTML = debugLog.map(entryHtml).join('');
  dbgLog.scrollTop = dbgLog.scrollHeight;
}

function appendLogEntry(entry: DebugEntry): void {
  const empty = dbgLog.querySelector('.dbg-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.innerHTML = entryHtml(entry);
  dbgLog.appendChild(div.firstElementChild!);
  dbgLog.scrollTop = dbgLog.scrollHeight;
}

function entryHtml(e: DebugEntry): string {
  const orch = e.orchestrator ? `<span class="log-orch">[${esc(e.orchestrator)}]</span>` : '';
  return `<div class="log-entry ${esc(e.type)}"><span class="log-time">${esc(e.time)}</span>${orch}<span class="log-msg">${esc(e.message)}</span></div>`;
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
