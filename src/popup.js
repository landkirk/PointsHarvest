/** @typedef {'start'|'stop'|'getState'|'ping'|'purgeState'|'complete'|'progress'|'debugReady'|'debugEntry'} MsgAction */
const MSG_ACTION = /** @type {Record<string, MsgAction>} */ ({
  START:       'start',
  STOP:        'stop',
  GET_STATE:   'getState',
  PING:        'ping',
  PURGE:       'purgeState',
  COMPLETE:    'complete',
  PROGRESS:    'progress',
  DEBUG_READY: 'debugReady',
  DEBUG_ENTRY: 'debugEntry',
});

const dot        = document.getElementById('dot');
const statusEl   = document.getElementById('status');
const bar        = document.getElementById('progress-bar');
const labelEl    = document.getElementById('progress-label');
const btnStart   = document.getElementById('btn-start');
const btnStop    = document.getElementById('btn-stop');
const lastSearch = document.getElementById('last-search');
const debugCheck = document.getElementById('debug-check');
const debugPanel = document.getElementById('debug-panel');
const btnPurge   = document.getElementById('btn-purge');
const domStats   = document.getElementById('dom-stats');
const dbgCards   = document.getElementById('dbg-cards');
const dbgQueue   = document.getElementById('dbg-queue');
const dbgLog     = document.getElementById('dbg-log');

// ── Main UI ────────────────────────────────────────────────────────────────

function render({ isRunning, status, completedSearches, totalSearches, lastLabel }) {
  const completed = completedSearches || 0;
  const total     = totalSearches || 0;
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isDone    = !isRunning && completed > 0 && completed >= total && total > 0;

  statusEl.textContent   = status || 'Idle';
  bar.style.width        = pct + '%';
  labelEl.textContent    = total > 0 ? `${completed} / ${total} searches` : '—';
  lastSearch.textContent = lastLabel ? `Last: ${lastLabel}` : '';

  dot.className = 'dot';
  if (isRunning)   dot.classList.add('running');
  else if (isDone) dot.classList.add('done');

  btnStart.disabled      = isRunning;
  btnStop.style.display  = isRunning ? 'block' : 'none';
}

// Load state on open. If storage says running, ping to confirm the service worker
// is actually alive and running — if it was restarted, isActivelyRunning is false
// and we reset rather than showing a permanently-stuck running state.
chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }, (state) => {
  if (!state) return;
  if (!state.isRunning) {
    render(state);
    if (debugCheck.checked) renderDebug(state);
    return;
  }
  chrome.runtime.sendMessage({ action: MSG_ACTION.PING }, (response) => {
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
      isRunning: true,
      status: `Running (${msg.completed} / ${msg.total})`,
      completedSearches: msg.completed,
      totalSearches: msg.total,
      lastLabel: msg.label,
    });
  }
  if (msg.action === MSG_ACTION.COMPLETE) {
    chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }, (state) => {
      if (state) { render(state); if (debugCheck.checked) renderDebug(state); }
    });
  }
  if (msg.action === MSG_ACTION.DEBUG_READY && debugCheck.checked) {
    chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }, (state) => {
      if (state) {
        renderDomStats(state.domDebug);
        renderCards(state.mappedActivities, state.domDebug);
        renderQueue(state.searchQueue);
      }
    });
  }
  if (msg.action === MSG_ACTION.DEBUG_ENTRY && debugCheck.checked) {
    appendLogEntry(msg.entry);
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
    chrome.runtime.sendMessage({ action: MSG_ACTION.GET_STATE }, (state) => {
      if (state) renderDebug(state);
    });
  }
});

function clearDebug() {
  domStats.innerHTML = '';
  dbgCards.innerHTML = '<div class="dbg-empty">Waiting for extraction…</div>';
  dbgQueue.innerHTML = '<div class="dbg-empty">Not yet built.</div>';
  dbgLog.innerHTML    = '<div class="dbg-empty">No events yet.</div>';
}

function renderDebug({ domDebug, mappedActivities, searchQueue, debugLog }) {
  renderDomStats(domDebug);
  renderCards(mappedActivities, domDebug);
  renderQueue(searchQueue);
  renderLog(debugLog);
}

function renderDomStats(domDebug) {
  if (!domDebug) { domStats.innerHTML = ''; return; }
  const el = domStats;
  el.innerHTML = `
    <span title="Total cards scanned">${domDebug.totalCards} cards</span>
    <span title="'Search on Bing' cards found">${domDebug.actionElementsFound} matches</span>
    <span title="Cards skipped because they were locked">${domDebug.skippedLocked} locked</span>
  `;
}


function renderCards(mappedActivities, domDebug) {
  const el = dbgCards;
  if (!domDebug && (!mappedActivities || mappedActivities.length === 0)) {
    el.innerHTML = '<div class="dbg-empty">Run the extension to see extraction results.</div>';
    return;
  }

  // Show skipped/locked cards from domDebug
  const skipped = (domDebug?.cards || []).filter(c => c.skipped);
  const items = [...(mappedActivities || [])];

  if (items.length === 0 && skipped.length === 0) {
    el.innerHTML = '<div class="dbg-empty">No activity cards found.</div>';
    return;
  }

  el.innerHTML = items.map(a => `
    <div class="dbg-card">
      <div class="card-title">${esc(a.title || '(no title)')}</div>
      <div class="card-desc">${esc(a.description || '')}</div>
      ${a.unmatched
        ? '<div class="card-skip">No query could be generated — skipped</div>'
        : `<div class="card-query">→ ${esc(a.query)}</div>`
      }
    </div>
  `).join('') + skipped.map(c => `
    <div class="dbg-card">
      <div class="card-title" style="color:#555">${esc(c.cardSnippet || '(no title)')}</div>
      <div class="card-skip">Skipped: ${esc(c.skipped)}</div>
    </div>
  `).join('');
}

function renderQueue(searchQueue) {
  const el = dbgQueue;
  if (!searchQueue || searchQueue.length === 0) {
    el.innerHTML = '<div class="dbg-empty">Not yet built.</div>';
    return;
  }
  el.innerHTML = searchQueue.map((q, i) => `
    <div class="dbg-queue-item">
      <span class="idx">${i + 1}.</span>${esc(q)}
    </div>
  `).join('');
}

function renderLog(debugLog) {
  const el = dbgLog;
  if (!debugLog || debugLog.length === 0) {
    el.innerHTML = '<div class="dbg-empty">No events yet.</div>';
    return;
  }
  el.innerHTML = debugLog.map(e => `
    <div class="log-entry ${esc(e.type)}">
      <span class="log-time">${esc(e.time)}</span>
      <span class="log-msg">${esc(e.message)}</span>
    </div>
  `).join('');
  el.scrollTop = el.scrollHeight;
}

function appendLogEntry(entry) {
  const el = dbgLog;
  const empty = el.querySelector('.dbg-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = `log-entry ${entry.type}`;
  div.innerHTML = `<span class="log-time">${esc(entry.time)}</span><span class="log-msg">${esc(entry.message)}</span>`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
