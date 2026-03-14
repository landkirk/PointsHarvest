import { MSG_ACTION } from './util/config.js';
import type { AppState, SearchCounter } from './util/state.js';
import type { DomDebug, DailySetDebug } from './util/debug.js';
import type { DebugEntry } from './util/debug.js';
import type { MappedActivity } from './util/activity.js';

const dot         = document.getElementById('dot')!;
const statusEl    = document.getElementById('status')!;
const bar         = document.getElementById('progress-bar') as HTMLElement;
const labelEl     = document.getElementById('progress-label')!;
const btnStart    = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop     = document.getElementById('btn-stop') as HTMLElement;
const btnDone     = document.getElementById('btn-done') as HTMLElement;
const lastSearch  = document.getElementById('last-search')!;
const debugCheck  = document.getElementById('debug-check') as HTMLInputElement;
const debugPanel  = document.getElementById('debug-panel')!;
const btnPurge    = document.getElementById('btn-purge')!;
const dbgCounters = document.getElementById('dbg-counters')!;
const domStats    = document.getElementById('dom-stats')!;
const dbgCards    = document.getElementById('dbg-cards')!;
const dbgQueue    = document.getElementById('dbg-queue')!;
const dbgLog      = document.getElementById('dbg-log')!;

// ── Main UI ────────────────────────────────────────────────────────────────

interface RenderState {
  isRunning?:        boolean;
  isLingering?:      boolean;
  status?:           string;
  completedSearches?: number;
  totalSearches?:    number;
  lastLabel?:        string;
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
      status:            `Running (${msg.completed} / ${msg.total})`,
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
  if (msg.action === MSG_ACTION.DEBUG_READY && debugCheck.checked) {
    chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }, (state: AppState) => {
      if (state) {
        renderSearchCounters(state.searchCounters);
        renderDomStats(state.domDebug, state.dailySetDebug);
        renderCards(state.mappedActivities as MappedActivity[], state.domDebug, state.dailySetDebug);
        renderQueue(state.searchQueue);
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
  dbgCounters.innerHTML = '<div class="dbg-empty">No data yet.</div>';
  domStats.innerHTML    = '';
  dbgCards.innerHTML    = '<div class="dbg-empty">Waiting for extraction…</div>';
  dbgQueue.innerHTML    = '<div class="dbg-empty">Not yet built.</div>';
  dbgLog.innerHTML      = '<div class="dbg-empty">No events yet.</div>';
}

function renderDebug({ domDebug, dailySetDebug, searchCounters, mappedActivities, searchQueue, debugLog }: AppState): void {
  renderSearchCounters(searchCounters);
  renderDomStats(domDebug, dailySetDebug);
  renderCards(mappedActivities as MappedActivity[], domDebug, dailySetDebug);
  renderQueue(searchQueue);
  renderLog(debugLog);
}

function renderSearchCounters(searchCounters: SearchCounter[]): void {
  if (!searchCounters || searchCounters.length === 0) {
    dbgCounters.innerHTML = '<div class="dbg-empty">No data yet.</div>';
    return;
  }
  dbgCounters.innerHTML = searchCounters.map(c => `
    <span title="${esc(c.type)}">${esc(c.type)}: ${c.current}/${c.max}</span>
  `).join('');
}

function renderDomStats(domDebug: DomDebug | null, dailySetDebug: DailySetDebug | null): void {
  if (!domDebug && !dailySetDebug) { domStats.innerHTML = ''; return; }
  domStats.innerHTML = `
    ${domDebug ? `
      <span title="Total cards scanned">${domDebug.totalCards} cards</span>
      <span title="'Search on Bing' cards found">${domDebug.actionElementsFound} matches</span>
      <span title="Cards skipped because they were locked">${domDebug.skippedLocked} locked</span>
    ` : ''}
    ${dailySetDebug ? `
      <span title="Daily set section found on page">Daily set: ${dailySetDebug.sectionFound ? `${dailySetDebug.actionable}/${dailySetDebug.totalTiles} actionable` : 'not found'}</span>
    ` : ''}
  `;
}

function renderCards(mappedActivities: MappedActivity[], domDebug: DomDebug | null, dailySetDebug: DailySetDebug | null): void {
  const el      = dbgCards;
  const skipped = (domDebug?.cards ?? []).filter(c => c.skipped);
  const items   = mappedActivities ?? [];
  const dsTiles = dailySetDebug?.tiles ?? [];

  if (!domDebug && !dailySetDebug && items.length === 0) {
    el.innerHTML = '<div class="dbg-empty">Run the extension to see extraction results.</div>';
    return;
  }

  if (items.length === 0 && skipped.length === 0 && dsTiles.length === 0) {
    el.innerHTML = '<div class="dbg-empty">No activity cards found.</div>';
    return;
  }

  const searchHtml = items.map(a => `
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
      <div class="card-skip">Skipped: ${esc(c.skipped ?? '')}</div>
    </div>
  `).join('');

  const dsHtml = dsTiles.length === 0 ? '' : `
    <div class="dbg-section-label">Daily set</div>
    ${dsTiles.map(t => `
      <div class="dbg-card">
        <div class="card-title${t.skipped ? ' skipped' : ''}">${esc(t.snippet || t.biId || '(no title)')}</div>
        ${t.skipped
          ? `<div class="card-skip">Skipped: ${esc(t.skipped)}</div>`
          : `<div class="card-query" title="${esc(t.href ?? '')}">→ ${esc(t.href ?? '')}</div>`
        }
      </div>
    `).join('')}
  `;

  el.innerHTML = searchHtml + dsHtml;
}

function renderQueue(searchQueue: string[]): void {
  if (!searchQueue || searchQueue.length === 0) {
    dbgQueue.innerHTML = '<div class="dbg-empty">Not yet built.</div>';
    return;
  }
  dbgQueue.innerHTML = searchQueue.map((q, i) => `
    <div class="dbg-queue-item">
      <span class="idx">${i + 1}.</span>${esc(q)}
    </div>
  `).join('');
}

function renderLog(debugLog: DebugEntry[]): void {
  if (!debugLog || debugLog.length === 0) {
    dbgLog.innerHTML = '<div class="dbg-empty">No events yet.</div>';
    return;
  }
  dbgLog.innerHTML = debugLog.map(e => `
    <div class="log-entry ${esc(e.type)}">
      <span class="log-time">${esc(e.time)}</span>
      <span class="log-msg">${esc(e.message)}</span>
    </div>
  `).join('');
  dbgLog.scrollTop = dbgLog.scrollHeight;
}

function appendLogEntry(entry: DebugEntry): void {
  const empty = dbgLog.querySelector('.dbg-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = `log-entry ${entry.type}`;
  div.innerHTML = `<span class="log-time">${esc(entry.time)}</span><span class="log-msg">${esc(entry.message)}</span>`;
  dbgLog.appendChild(div);
  dbgLog.scrollTop = dbgLog.scrollHeight;
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
