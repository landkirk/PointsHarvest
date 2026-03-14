import { MSG_ACTION } from './config.js';
import { setState } from './state.js';

export type DebugType = 'info' | 'warn' | 'error' | 'success';

export interface DebugEntry {
  time: string;
  type: DebugType;
  message: string;
}

export interface DomDebugCard {
  skipped:      string | null;
  cardSnippet?: string;
  title?:       string;
  description?: string;
  href?:        string | null;
}

export interface DomDebug {
  totalCards:          number;
  actionElementsFound: number;
  skippedLocked:       number;
  skippedCompleted:    number;
  skippedUnknown:      number;
  cards:               DomDebugCard[];
}

export interface DailySetDebugTile {
  skipped:  string | null;
  snippet:  string;
  biId:     string;
  href?:    string;
}

export interface DailySetDebug {
  sectionFound: boolean;
  totalTiles?:  number;
  actionable?:  number;
  tiles?:       DailySetDebugTile[];
}

export interface SearchCounterDebugCard {
  skipped:   string | null;
  type:      string;
  rawText?:  string;
  current?:  number;
  max?:      number;
}

export interface SearchCounterDebug {
  sectionFound: boolean;
  total?:       number;
  extracted?:   number;
  cards?:       SearchCounterDebugCard[];
}

const MAX_LOG_ENTRIES = 100;

let log: DebugEntry[] = [];

/** Clears the in-memory log (call at the start of each run). */
export function resetLog(): void {
  log = [];
}

/** Appends a typed log entry, persists to storage, and notifies the popup. */
export async function dbg(type: DebugType, message: string): Promise<void> {
  const entry: DebugEntry = { time: new Date().toLocaleTimeString('en-US', { hour12: false }), type, message };
  log.push(entry);
  if (log.length > MAX_LOG_ENTRIES) log.shift();
  await setState({ debugLog: log });
  chrome.runtime.sendMessage({ action: MSG_ACTION.DEBUG_ENTRY, entry }).catch(() => {});
}
