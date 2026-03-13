// ── Ephemeral session ──────────────────────────────────────────────────────
// In-memory only. Resets whenever the service worker restarts.

const INITIAL_SESSION = {
  pendingTabId: null,           // search tab we're waiting on to load
  pendingResolve: null,         // resolves when pendingTabId finishes loading
  resolveActivities: null,      // resolves fetchAvailableActivities() promise
  captureNextTabResolve: null,  // resolves with the tab opened by a card click
  openedTabIds: new Set(),      // all tabs this extension has opened
  isActivelyRunning: false,     // distinguishes "storage says running" from "actually running"
  rewardsTabId: null,           // the rewards dashboard tab — kept open until all cards are clicked
  lingerTabId: null,            // tab the user needs to interact with (requiresUserAction tiles)
  lingerResolve: null,          // resolves lingerOnTab()'s promise
};

export const session = { ...INITIAL_SESSION, openedTabIds: new Set() };

/** Reset all session fields to their initial values. Call at the start of each run. */
export function resetSession() {
  Object.assign(session, INITIAL_SESSION, { openedTabIds: new Set() });
}

// ── Persistent store ───────────────────────────────────────────────────────
// Backed by chrome.storage.local. Survives service worker restarts.
// Uses a write-through in-memory cache so reads during a run are synchronous.
//
//   await loadState()        — populate cache from storage (call at startup / GET_STATE)
//   getState()               — synchronous read from cache (valid after loadState)
//   await setState({ ... })  — write through to cache + storage
//   await resetState()       — restore all fields to INITIAL_STATE

export const INITIAL_STATE = {
  isRunning:            false,
  isLingering:          false,
  status:               'idle',
  currentIndex:         0,
  completedSearches:    0,
  totalSearches:        0,
  lastRunDate:          null,
  lastLabel:            '',
  debugLog:             [],
  domDebug:             null,
  dailySetDebug:        null,
  extractedActivities:  [],
  mappedActivities:     [],
  searchQueue:          [],
};

let cache = null;

/** Load from storage into cache. Returns the loaded state. */
export async function loadState() {
  const stored = await chrome.storage.local.get(null);
  cache = { ...INITIAL_STATE, ...stored };
  return cache;
}

/** Synchronous read from cache. Requires loadState() to have been called first. */
export function getState() {
  return cache ?? { ...INITIAL_STATE };
}

/** Write updates to both the cache and storage. */
export async function setState(updates) {
  if (!cache) cache = { ...INITIAL_STATE };
  Object.assign(cache, updates);
  await chrome.storage.local.set(updates);
}

/** Reset all persistent state to initial values, with optional overrides applied atomically. */
export async function resetState(overrides = {}) {
  cache = { ...INITIAL_STATE, ...overrides };
  await chrome.storage.local.set(cache);
}
