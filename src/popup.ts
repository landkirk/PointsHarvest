import { MSG_ACTION } from './util/messaging.js';
import type { AppState, SearchCounter } from './util/state.js';
import type { DomDebug, DailySetDebug, DebugEntry } from './util/debug.js';
import type { MappedActivity } from './util/activity.js';

const dot              = document.getElementById('dot')!;
const statusEl         = document.getElementById('status')!;
const bar              = document.getElementById('progress-bar') as HTMLElement;
const labelEl          = document.getElementById('progress-label')!;
const btnStart         = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop          = document.getElementById('btn-stop') as HTMLElement;
const btnDone          = document.getElementById('btn-done') as HTMLElement;
const lastSearch       = document.getElementById('last-search')!;
const debugCheck       = document.getElementById('debug-check') as HTMLInputElement;
const debugPanel       = document.getElementById('debug-panel')!;
const btnPurge         = document.getElementById('btn-purge')!;
const dbgExploreStats  = document.getElementById('dbg-explore-stats')!;
const dbgExploreCards  = document.getElementById('dbg-explore-cards')!;
const dbgExploreQueue  = document.getElementById('dbg-explore-queue')!;
const dbgDailyStats    = document.getElementById('dbg-daily-stats')!;
const dbgDailyCards    = document.getElementById('dbg-daily-cards')!;
const dbgPcCounters    = document.getElementById('dbg-pc-counters')!;
const dbgLog           = document.getElementById('dbg-log')!;

// ── Main UI ────────────────────────────────────────────────────────────────

interface RenderState {
  isRunning?:         boolean;
  isLingering?:       boolean;
  status?:            string;
  completedSearches?: number;
  totalSearches?:     number;
  lastLabel?:         string;
}

function render({ isRunning, isLingering, status, completedSearches, totalSearches, lastLabel }: RenderState): void {
  const completed = completedSearches || 0;
  const total     = totalSearches || 0;
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isDone    = !isRunning && completed > 0 && completed >= total && total > 0;

  statusEl.textContent   = status || 'Idle';
  bar.style.width        = pct + '%';
  labelEl.textContent    = total > 0 ? `${completed} / ${total} searches` : '—';
  lastSearch.textContent = lastLabel ? `Last: ${lastLabel}` : '';

  dot.className = 'dot';
  if (isLingering)     dot.classList.add('waiting');
  else if (isRunning)  dot.classList.add('running');
  else if (isDone)     dot.classList.add('done');

  btnStart.disabled     = !!isRunning;
  btnStop.style.display = isRunning ? 'block' : 'none';
  btnDone.style.display = isLingering ? 'block' : 'none';
}

// Load state on open. If storage says running, ping to confirm the service worker
// is actually alive and running — if it was restarted, isActivelyRunning is false
// and we reset rather than showing a permanently-stuck running state.
chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }, (state: AppState) => {
  if (!state) return;
  if (!state.isRunning) {
    render(state);
    if (debugCheck.checked) renderDebug(state);
    return;
  }
  chrome.runtime.sendMessage({ action: MSG_ACTION.PING }, (response: { running: boolean }) => {
    if (!response?.running) {
      chrome.storage.local.set({ isRunning: false, status: 'Stopped' });
      state = { ...state, isRunning: false, status: 'Stopped' };
    }
    render(state);
    if (debugCheck.checked) renderDebug(state);
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === MSG_ACTION.PROGRESS) {
    render({
      isRunning:         true,
      status:            msg.status,
      completedSearches: msg.completed,
      totalSearches:     msg.total,
      lastLabel:         msg.label,
    });
  }
  if (msg.action === MSG_ACTION.COMPLETE) {
    chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }, (state: AppState) => {
      if (state) { render(state); if (debugCheck.checked) renderDebug(state); }
    });
  }
  if (msg.action === MSG_ACTION.ACTIVITIES_MAPPED && debugCheck.checked) {
    chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }, (state: AppState) => {
      if (state) {
        renderExploreSection(state.domDebug, state.mappedActivities as MappedActivity[]);
        renderDailySection(state.dailySetDebug);
        renderPcCounters(state.searchCounters);
      }
    });
  }
  if (msg.action === MSG_ACTION.DEBUG_ENTRY && debugCheck.checked) {
    appendLogEntry(msg.entry as DebugEntry);
  }
  if (msg.action === MSG_ACTION.LINGER_WAITING) {
    render({ isRunning: true, isLingering: true, status: 'Action required — complete the activity in the tab' });
  }
});

btnStart.addEventListener('click', () => {
  btnStart.disabled = true;
  chrome.runtime.sendMessage({ action: MSG_ACTION.START });
  render({ isRunning: true, status: 'Starting…', completedSearches: 0, totalSearches: 0 });
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
  chrome.runtime.sendMessage({ action: MSG_ACTION.PURGE }, () => {
    render({ isRunning: false, status: 'Idle' });
    clearDebug();
  });
});

// ── Debug panel ────────────────────────────────────────────────────────────

debugCheck.addEventListener('change', () => {
  debugPanel.classList.toggle('open', debugCheck.checked);
  if (debugCheck.checked) {
    chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }, (state: AppState) => {
      if (state) renderDebug(state);
    });
  }
});

function clearDebug(): void {
  dbgExploreStats.innerHTML = '';
  dbgExploreCards.innerHTML = '<div class="dbg-empty">Run the extension to see extraction results.</div>';
  dbgExploreQueue.innerHTML = '<div class="dbg-empty">Not yet built.</div>';
  dbgDailyStats.innerHTML   = '';
  dbgDailyCards.innerHTML   = '<div class="dbg-empty">Run the extension to see results.</div>';
  dbgPcCounters.innerHTML   = '<div class="dbg-empty">No data yet.</div>';
  dbgLog.innerHTML          = '<div class="dbg-empty">No events yet.</div>';
}

function renderDebug({ domDebug, dailySetDebug, searchCounters, mappedActivities, debugLog }: AppState): void {
  renderExploreSection(domDebug, mappedActivities as MappedActivity[]);
  renderDailySection(dailySetDebug);
  renderPcCounters(searchCounters);
  renderLog(debugLog);
}

// ── Explore on Bing ────────────────────────────────────────────────────────

function renderExploreSection(domDebug: DomDebug | null, mappedActivities: MappedActivity[]): void {
  renderExploreStats(domDebug);
  renderExploreCards(domDebug, mappedActivities);
  renderSearchQueue(mappedActivities);
}

function renderStats(el: HTMLElement, total: number, actionable: number, locked: number, completed: number): void {
  el.innerHTML = `
    <span title="Total cards scanned">${total} cards</span>
    <span title="Actionable cards found">${actionable} actionable</span>
    <span title="Locked cards">${locked} locked</span>
    <span title="Completed cards">${completed} completed</span>
  `;
}

function renderExploreStats(domDebug: DomDebug | null): void {
  if (!domDebug) { dbgExploreStats.innerHTML = ''; return; }
  renderStats(dbgExploreStats, domDebug.totalCards, domDebug.actionElementsFound, domDebug.skippedLocked, domDebug.skippedCompleted);
}

function renderExploreCards(domDebug: DomDebug | null, mappedActivities: MappedActivity[]): void {
  const skipped = (domDebug?.cards ?? []).filter(c => c.skipped);
  const items   = mappedActivities ?? [];

  if (!domDebug && items.length === 0) {
    dbgExploreCards.innerHTML = '<div class="dbg-empty">Run the extension to see extraction results.</div>';
    return;
  }
  if (items.length === 0 && skipped.length === 0) {
    dbgExploreCards.innerHTML = '<div class="dbg-empty">No activity cards found.</div>';
    return;
  }

  dbgExploreCards.innerHTML = items.map(a => `
    <div class="dbg-card">
      <div class="card-title${a.unmatched ? ' skipped' : ''}">${esc(a.title || '(no title)')}</div>
      <div class="card-desc">${esc(a.description || '')}</div>
      ${a.unmatched
        ? '<div class="card-skip">No query could be generated — skipped</div>'
        : `<div class="card-query">→ ${esc(a.query!)}</div>`
      }
    </div>
  `).join('') + skipped.map(c => `
    <div class="dbg-card">
      <div class="card-title skipped">${esc(c.cardSnippet || '(no title)')}</div>
      <div class="card-skip card-skip--${esc(c.skipped ?? '')}">Skipped: ${esc(c.skipped ?? '')}</div>
    </div>
  `).join('');
}

function renderSearchQueue(mappedActivities: MappedActivity[]): void {
  const queue = (mappedActivities ?? []).filter(m => m.query).map(m => m.query as string);
  if (queue.length === 0) {
    dbgExploreQueue.innerHTML = '<div class="dbg-empty">Not yet built.</div>';
    return;
  }
  dbgExploreQueue.innerHTML = queue.map((q, i) => `
    <div class="dbg-queue-item">
      <span class="idx">${i + 1}.</span>${esc(q)}
    </div>
  `).join('');
}

// ── Daily Sets ─────────────────────────────────────────────────────────────

function renderDailySection(dailySetDebug: DailySetDebug | null): void {
  if (!dailySetDebug) {
    dbgDailyStats.innerHTML = '';
    dbgDailyCards.innerHTML = '<div class="dbg-empty">Run the extension to see results.</div>';
    return;
  }

  if (!dailySetDebug.sectionFound) {
    dbgDailyStats.innerHTML = '<span>Section not found</span>';
  } else {
    const acts = dailySetDebug.activities ?? [];
    renderStats(dbgDailyStats, acts.length, dailySetDebug.actionable ?? 0, dailySetDebug.skippedLocked ?? 0, dailySetDebug.skippedCompleted ?? 0);
  }

  const activities = dailySetDebug.activities ?? [];
  if (activities.length === 0) {
    dbgDailyCards.innerHTML = '<div class="dbg-empty">No daily set activities found.</div>';
    return;
  }

  dbgDailyCards.innerHTML = activities.map(t => `
    <div class="dbg-card">
      <div class="card-title${t.skipped ? ' skipped' : ''}">${esc(t.snippet || t.biId || '(no title)')}</div>
      ${t.skipped
        ? `<div class="card-skip card-skip--${esc(t.skipped)}">Skipped: ${esc(t.skipped)}</div>`
        : `<div class="card-query" title="${esc(t.href ?? '')}">→ ${esc(t.href ?? '')}</div>`
      }
    </div>
  `).join('');
}

// ── PC Search Farming ──────────────────────────────────────────────────────

function renderPcCounters(searchCounters: SearchCounter[]): void {
  if (!searchCounters || searchCounters.length === 0) {
    dbgPcCounters.innerHTML = '<div class="dbg-empty">No data yet.</div>';
    return;
  }
  dbgPcCounters.innerHTML = searchCounters.map(c => {
    const isPC = c.type.toLowerCase() === 'pc search';
    const cls  = isPC ? ' class="pc-active"' : '';
    return `<span${cls} title="${esc(c.type)}">${esc(c.type)}: ${c.current}/${c.max}</span>`;
  }).join('');
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
