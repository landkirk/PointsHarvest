// Manages the debug log: in-memory buffer, storage sync, and popup broadcast.
import { MSG_ACTION } from './config.js';
import { setState } from './state.js';

const MAX_LOG_ENTRIES = 100;

let log = [];

/** Clears the in-memory log (call at the start of each run). */
export function resetLog() {
  log = [];
}

/** Appends a typed log entry, persists to storage, and notifies the popup. */
export async function dbg(type, message) {
  const entry = { time: new Date().toLocaleTimeString('en-US', { hour12: false }), type, message };
  log.push(entry);
  if (log.length > MAX_LOG_ENTRIES) log.shift();
  await setState({ debugLog: log });
  chrome.runtime.sendMessage({ action: MSG_ACTION.DEBUG_ENTRY, entry }).catch(() => {});
}

