import { CardState } from '../util/activity.js';
import { PHASE, PHASE_TIME_LABEL } from '../util/state.js';
import type { AppState, PhaseKey, SearchCounter } from '../util/state.js';
import type { ActivityScan } from '../util/debug.js';
import type { MappedActivity } from '../util/activity.js';
import type { DebugEntry } from '../util/messaging.js';

// ── Generic activity debug view ─────────────────────────────────────────────

interface ActivityDebugItem {
  id?: string;
  title: string;
  description?: string;
  skipReason?: CardState | null;
  action?: string;
  points?: number;
}

interface ActivityDebugData {
  stats?: { total: number; actionable: number; locked: number; completed: number };
  items: ActivityDebugItem[];
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
  renderActivitySection(
    dbgExplore,
    exploreToActivityData(state.debug.domDebug, state.mappedActivities as MappedActivity[]),
    LIST_SIZE.LARGE,
    phasePoints[PHASE.EXPLORE],
    PHASE.EXPLORE,
  );
  renderActivitySection(
    dbgDaily,
    dailySetsToActivityData(state.debug.dailySetDebug),
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
      data.items
        .map(
          (item) => `
      <div class="dbg-card" data-status="${esc(item.skipReason ?? CardState.Actionable)}">
        <div class="card-title${item.skipReason ? ' skipped' : ''}">${item.id ? `<span class="card-id">${esc(item.id)}</span> ` : ''}${esc(item.title)}</div>
        ${item.description ? `<div class="card-desc">${esc(item.description)}</div>` : ''}
        ${
          item.skipReason
            ? `<div class="card-skip card-skip--${esc(item.skipReason)}">Skipped: ${esc(item.skipReason)}</div>`
            : item.action
              ? `<div class="card-query" title="${esc(item.action)}">→ ${esc(item.action)}</div>`
              : ''
        }
        ${item.points !== undefined ? `<div class="card-points">${item.points} pts</div>` : ''}
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
      id: a.id,
      title: a.title || '(no title)',
      description: a.description || undefined,
      skipReason: a.unmatched ? CardState.Unknown : null,
      action: a.unmatched ? undefined : (a.query ?? undefined),
      points: a.points,
    })),
    ...(scan?.activities ?? []).map((c) => ({
      title: c.snippet,
      skipReason: c.skipReason,
      points: c.points,
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
    id: t.id,
    title: t.snippet || '(no title)',
    skipReason: t.skipReason,
    points: t.points,
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
