import { CardState, ACTIVITY_TYPE } from '../util/activity.js';
import { PHASE, PHASE_TIME_LABEL } from '../util/state.js';
import type { AppState, PhaseKey, SearchCounter } from '../util/state.js';
import type { Activity } from '../util/activity.js';
import type { DebugEntry } from '../util/debug.js';

// ── Generic activity debug view ─────────────────────────────────────────────

interface ActivityDebugData {
  stats?: { total: number; actionable: number; locked: number; completed: number };
  items: Activity[];
  emptyMessage: string;
  queue?: string[];
}

// ── DOM refs ────────────────────────────────────────────────────────────────

const dbgWarmUp = document.getElementById('dbg-warmup') as HTMLElement;
const dbgExplore = document.getElementById('dbg-explore') as HTMLElement;
const dbgDaily = document.getElementById('dbg-daily') as HTMLElement;
const dbgPcCounters = document.getElementById('dbg-pc-counters') as HTMLElement;
const dbgLog = document.getElementById('dbg-log') as HTMLElement;

// ── Public API ──────────────────────────────────────────────────────────────

export function renderDebug(state: AppState): void {
  renderWarmUp(state.warmUpQueries);
  renderActivitiesAndCounters(state);
  renderLog(state.debug.debugLog);
}

export function clearDebug(): void {
  renderWarmUp([]);
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

export function appendLogEntry(entry: DebugEntry): void {
  const empty = dbgLog.querySelector('.dbg-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.innerHTML = entryHtml(entry);
  dbgLog.appendChild(div.firstElementChild as Element);
  dbgLog.scrollTop = dbgLog.scrollHeight;
}

export function renderActivitiesAndCounters(state: AppState): void {
  const phasePoints = state.header.phasePoints;
  const allActivities = state.activityState?.allActivities ?? [];
  const exploreActivities = allActivities.filter(
    (a) => a.activityType === ACTIVITY_TYPE.EXPLORE_ON_BING,
  );
  const dailyActivities = allActivities.filter((a) => a.activityType === ACTIVITY_TYPE.DAILY_SET);
  renderActivitySection(
    dbgExplore,
    exploreToActivityData(exploreActivities),
    LIST_SIZE.LARGE,
    phasePoints[PHASE.EXPLORE],
    PHASE.EXPLORE,
  );
  renderActivitySection(
    dbgDaily,
    dailySetsToActivityData(dailyActivities),
    LIST_SIZE.MEDIUM,
    phasePoints[PHASE.DAILY],
    PHASE.DAILY,
  );
  renderPcCounters(state.searchCounters, phasePoints[PHASE.FARM]);
}

export function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Generic activity section renderer ──────────────────────────────────────

type ListSize = 'small' | 'medium' | 'large';
const LIST_SIZE = { SMALL: 'small', MEDIUM: 'medium', LARGE: 'large' } as const;

function renderActivitySection(
  container: HTMLElement,
  data: ActivityDebugData,
  listSize: ListSize = LIST_SIZE.LARGE,
  pts?: number,
  phase?: PhaseKey,
): void {
  let html = '';

  if (pts !== undefined && pts > 0) {
    html += `<div class="dbg-run-stat">+${pts} pts ${esc(phase ? PHASE_TIME_LABEL[phase] : '')}</div>`;
  }

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
      data.items.map(activityCardHtml).join('') +
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
      const filter = span.dataset.filter ?? '';
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

function buildScanStats(scan: Activity[]): {
  total: number;
  actionable: number;
  locked: number;
  completed: number;
} {
  const stats = { total: scan.length, actionable: 0, locked: 0, completed: 0 };
  for (const a of scan) {
    if (a.cardState === CardState.Actionable) stats.actionable++;
    else if (a.cardState === CardState.Locked) stats.locked++;
    else if (a.cardState === CardState.Completed) stats.completed++;
  }
  return stats;
}

function exploreToActivityData(activities: Activity[]): ActivityDebugData {
  if (activities.length === 0) {
    return {
      items: [],
      emptyMessage: 'Run the extension to see extraction results.',
      queue: undefined,
    };
  }
  const stats = buildScanStats(activities);
  const queue = activities
    .filter((a) => a.searchQuery && a.cardState === CardState.Actionable)
    .map((a) => a.searchQuery as string);
  return { stats, items: activities, emptyMessage: 'No activity cards found.', queue };
}

function dailySetsToActivityData(activities: Activity[]): ActivityDebugData {
  if (activities.length === 0) {
    return { items: [], emptyMessage: 'Run the extension to see results.' };
  }
  return {
    stats: buildScanStats(activities),
    items: activities,
    emptyMessage: 'No daily set activities found.',
  };
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function activityCardHtml(a: Activity): string {
  const state: CardState | null = a.cardState !== CardState.Actionable ? a.cardState : null;

  const descLine =
    a.activityType === ACTIVITY_TYPE.EXPLORE_ON_BING && a.searchQuery !== undefined && a.description
      ? `<div class="card-desc">${esc(a.description)}</div>`
      : '';

  let actionLine = '';
  if (state) {
    actionLine = `<div class="card-skip card-skip--${esc(state)}">Skipped: ${esc(state)}</div>`;
  } else if (a.searchQuery) {
    actionLine = `<div class="card-query" title="${esc(a.searchQuery)}">→ ${esc(a.searchQuery)}</div>`;
    if (a.fallbackQuery) {
      actionLine += `<div class="card-query-fb" title="${esc(a.fallbackQuery)}">↳ fallback: ${esc(a.fallbackQuery)}</div>`;
    }
  }

  const userActionLine = a.requiresUserAction
    ? `<div class="card-user-action">User action required (${a.userActionTimeoutMs / 1000}s)</div>`
    : '';

  return `
    <div class="dbg-card" data-status="${esc(state ?? CardState.Actionable)}">
      <div class="card-title${state ? ' skipped' : ''}"><span class="card-id">${esc(a.id)}</span> ${esc(a.title || '(no title)')}</div>
      ${descLine}
      ${actionLine}
      ${userActionLine}
      <div class="card-points">${a.points} pts</div>
    </div>
  `;
}

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
  dbgWarmUp.innerHTML = queryListHtml(
    queries,
    'Run the extension to see warm-up queries.',
    LIST_SIZE.LARGE,
  );
}

// ── PC Search Farming ──────────────────────────────────────────────────────

function renderPcCounters(searchCounters: SearchCounter[], pts?: number): void {
  let html = '';
  if (pts !== undefined && pts > 0) {
    html += `<div class="dbg-run-stat">+${pts} pts today</div>`;
  }
  if (searchCounters.length === 0) {
    html += '<div class="dbg-empty">No counter data yet.</div>';
    dbgPcCounters.innerHTML = html;
    return;
  }
  dbgPcCounters.innerHTML =
    html +
    searchCounters
      .map((c) => `<span title="${esc(c.type)}">${esc(c.type)}: ${c.current}/${c.max}</span>`)
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

function entryHtml(e: DebugEntry): string {
  const orch = e.orchestrator ? `<span class="log-orch">[${esc(e.orchestrator)}]</span>` : '';
  return `<div class="log-entry ${esc(e.type)}"><span class="log-time">${esc(e.time)}</span>${orch}<span class="log-msg">${esc(e.message)}</span></div>`;
}
