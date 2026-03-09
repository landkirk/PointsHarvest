// Manages the debug log: in-memory buffer, storage sync, and popup broadcast.

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
  await chrome.storage.local.set({ debugLog: log });
  chrome.runtime.sendMessage({ action: 'debugEntry', entry }).catch(() => {});
}

/** Triangular distribution biased toward the middle of [min, max]. */
export function randMs(min, max) {
  return Math.round(min + ((Math.random() + Math.random()) / 2) * (max - min));
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
