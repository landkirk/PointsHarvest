import type { PhaseDefinition, PhaseKey, PhaseProgress, PhaseStates } from './phase.js';
import type { DebugEntry } from './debug.js';
import type { FailureEntry } from './failures.js';

/** Typed payload for Context.setPhase — also used for stored retry updates. */
export interface PhaseUpdate {
  phase: PhaseDefinition;
  headerMessage: string;
  progress?: PhaseProgress;
  /** If omitted, existing points for the phase are preserved. */
  points?: number;
}

/** Background → Popup broadcast (merged state). */
export interface ProgressBroadcast {
  headerMessage: string;
  activePhase: PhaseKey | null;
  phaseStates: PhaseStates;
  linger: LingerInfo | null;
}

import type { ActivityType, CardState, RawCard, SectionKey } from './activity-types.js';
import type { LingerInfo, UserPreferences } from './persistent-state.js';

// ── Locating clickable elements ────────────────────────────────────────────

/** An element's on-screen geometry, from a locate message, used to aim a human-like click. */
export interface ClickPoint {
  x: number;
  y: number;
  w: number;
  h: number;
  vw: number;
  vh: number;
}

/** The controls (as opposed to cards) the content script can locate for clicking. */
export const CONTROL_KIND = {
  /** A section's disclosure toggle — collapsed sections don't render clickable cards. */
  SECTION_TOGGLE: 'sectionToggle',
  /** A section's "Show more" pagination control. */
  SHOW_MORE: 'showMore',
  /** The "Today's points" card on /earn that opens the "Points breakdown" flyout. */
  POINTS_TOGGLE: 'pointsToggle',
  /** The open "Points breakdown" or "Claim points" flyout's Close button. */
  DIALOG_CLOSE: 'dialogClose',
  /** The "Ready to claim" card on `/` that opens the "Claim points" flyout. */
  CLAIM_TOGGLE: 'claimToggle',
  /** The open "Claim points" flyout's confirm button. */
  CLAIM_CONFIRM: 'claimConfirm',
} as const;

/** The controls that stand alone on the page rather than belonging to a section. */
export type PageControlKind =
  | typeof CONTROL_KIND.POINTS_TOGGLE
  | typeof CONTROL_KIND.DIALOG_CLOSE
  | typeof CONTROL_KIND.CLAIM_TOGGLE
  | typeof CONTROL_KIND.CLAIM_CONFIRM;

export const LOCATE_STATUS = {
  /** Found, and it needs clicking — `point` is valid. */
  Ready: 'ready',
  /** Nothing to click: already in the target state. */
  Satisfied: 'satisfied',
  /** No such element. */
  Absent: 'absent',
} as const;

/**
 * Reply to LOCATE_CARD / LOCATE_CONTROL. The content script only ever *locates* —
 * the background does the clicking, over CDP, so the click is trusted.
 *
 * Note that "not found" maps to a different status per target: a missing card or
 * section toggle is Absent, but a missing "Show more" button means there are no
 * more pages — Satisfied. That's what lets one caller-side loop drive both.
 *
 * `tiles` is the card count in the target section (0 if the section isn't in the
 * DOM) — the actual measure of whether a phase can proceed. `via` names the tier
 * that resolved the element, for debugging selector drift.
 */
export type LocateResponse =
  | { status: typeof LOCATE_STATUS.Ready; point: ClickPoint; tiles: number; via: string }
  | { status: typeof LOCATE_STATUS.Satisfied; tiles: number; via: string }
  | { status: typeof LOCATE_STATUS.Absent; tiles: number; reason: string };

/**
 * Reply to READ_COUNTERS. `read` separates "flyout unreadable — worth polling
 * again" from "read fine; `searchCounters` is the definitive answer". `detail`
 * names why a read failed (dialog never opened, row missing) — without it,
 * twenty silent polls are undiagnosable from the debug log.
 */
export interface CountersResponse {
  read: boolean;
  searchCounters: { type: string; current: number; max: number }[];
  detail?: string;
}

/** One claimable activity row in the "Claim points" flyout (debug-log detail only). */
export interface ClaimRow {
  title: string;
  points: number;
}

/**
 * Reply to READ_CLAIM. `read: false` + `detail` = unreadable, worth polling.
 * target 'card': `points` is the "Ready to claim" card's value on `/`.
 * target 'flyout': `total` is the flyout's headline value (null if unparsed —
 * only possible alongside `empty`), `empty` is the "No points to claim right
 * now" state, `rows` is best-effort per-activity detail.
 */
export type ClaimReadResponse =
  | { read: true; target: 'card'; points: number }
  | { read: true; target: 'flyout'; total: number | null; rows: ClaimRow[]; empty: boolean }
  | { read: false; detail: string };

/**
 * Reply to EXTRACT_SECTIONS. `sectionTiles` is the raw anchor count per
 * requested section key (0 = section missing or collapsed — the orchestrator
 * expands before extracting, so 0 here is a warning sign). `warnings` name
 * skipped badge-less tiles, duplicate titles, and missing sections so they
 * surface in the debug panel instead of vanishing silently.
 */
export interface ExtractResponse {
  cards: RawCard[];
  sectionTiles: Record<string, number>;
  warnings: string[];
}

/**
 * Reply to VALIDATE_ACTIVITY — the card's live DOM state. `stateLabel` is the
 * tile's raw trailing label ("Activated", "Completed", '' when none), for the
 * debug log: an explore card reading "Activated" is armed-but-uncredited,
 * which is worth distinguishing from an untouched card.
 */
export interface ValidateActivityResponse {
  state: CardState;
  stateLabel?: string;
}

/**
 * Reply to REWARDS_STATUS — the readiness/login probe the background polls
 * while waiting for the rewards page. A rejected sendMessage means the content
 * script isn't injected yet; that (not a field here) is the "keep waiting"
 * signal. `domComplete: false` says the page is still loading, so the absence
 * of a logged-out signal proves nothing yet. Once `domComplete` is true,
 * `loggedOutSignal` carries the matched sign-in evidence, or null for a page
 * that shows none (the SPA can hydrate the header after readyState fires, so
 * callers should re-probe a few times before trusting a null).
 */
export interface RewardsStatusResponse {
  domComplete: boolean;
  loggedOutSignal: string | null;
}

// ── Message actions ────────────────────────────────────────────────────────

export const MSG_ACTION = {
  // Background ↔ rewards content script
  REWARDS_STATUS: 'rewardsStatus',
  EXTRACT_SECTIONS: 'extractSections',
  LOCATE_CARD: 'locateCard',
  LOCATE_CONTROL: 'locateControl',
  VALIDATE_ACTIVITY: 'validateActivity',
  // Background ↔ search content script
  PERFORM_SEARCH: 'performSearch',
  SCROLL_PAGE: 'scrollPage',
  CLICK_RESULT: 'clickResult',
  // Popup → background
  START: 'start',
  STOP: 'stop',
  GET_RUN_STATE: 'getRunState',
  GET_PREFERENCES: 'getPreferences',
  PING: 'ping',
  PURGE: 'purgeState',
  // Background/steps → popup
  PROGRESS: 'progress',
  DEBUG_ENTRY: 'debugEntry',
  // Popup → background
  USER_ACTION_COMPLETE: 'userActionComplete',
  RESET_STALE: 'resetStale',
  SET_PREFERENCE: 'setPreference',
  // Background → rewards content script (counter extraction)
  READ_COUNTERS: 'readCounters',
  // Background → rewards content script (claimable-points reads)
  READ_CLAIM: 'readClaim',
  FAILURE_ENTRY: 'failureEntry',
} as const;

// ── Discriminated union message types ─────────────────────────────────────

export type AppMessage =
  // Popup → Background
  | { action: typeof MSG_ACTION.START; skipWarmUp: boolean; windowId: number }
  | { action: typeof MSG_ACTION.STOP }
  | { action: typeof MSG_ACTION.GET_RUN_STATE }
  | { action: typeof MSG_ACTION.GET_PREFERENCES }
  | { action: typeof MSG_ACTION.PING }
  | { action: typeof MSG_ACTION.PURGE }
  | { action: typeof MSG_ACTION.USER_ACTION_COMPLETE }
  | { action: typeof MSG_ACTION.RESET_STALE }
  | {
      action: typeof MSG_ACTION.SET_PREFERENCE;
      updates: Partial<UserPreferences>;
    }
  // Background → Popup (broadcast)
  | ({ action: typeof MSG_ACTION.PROGRESS } & ProgressBroadcast)
  | { action: typeof MSG_ACTION.DEBUG_ENTRY; entry: DebugEntry }
  | { action: typeof MSG_ACTION.FAILURE_ENTRY; failure: FailureEntry }
  // Background ↔ Rewards content script
  | { action: typeof MSG_ACTION.REWARDS_STATUS }
  | { action: typeof MSG_ACTION.EXTRACT_SECTIONS; sections: SectionKey[] }
  | {
      action: typeof MSG_ACTION.LOCATE_CARD;
      title: string;
      destinationUrl: string;
      /** Scopes card lookup to this activity's section — see sectionForActivityType. */
      activityType: ActivityType;
    }
  | {
      action: typeof MSG_ACTION.LOCATE_CONTROL;
      control: typeof CONTROL_KIND.SECTION_TOGGLE | typeof CONTROL_KIND.SHOW_MORE;
      sectionKey: SectionKey;
    }
  // Standalone page controls (the points flyout) carry no section.
  | {
      action: typeof MSG_ACTION.LOCATE_CONTROL;
      control: PageControlKind;
    }
  | {
      action: typeof MSG_ACTION.VALIDATE_ACTIVITY;
      title: string;
      destinationUrl: string;
      activityType: ActivityType;
    }
  | { action: typeof MSG_ACTION.READ_COUNTERS }
  | { action: typeof MSG_ACTION.READ_CLAIM; target: 'card' | 'flyout' }
  // Background → Search content script
  | { action: typeof MSG_ACTION.PERFORM_SEARCH; query: string }
  | { action: typeof MSG_ACTION.SCROLL_PAGE; y: number; behavior: 'smooth' | 'instant' }
  | { action: typeof MSG_ACTION.CLICK_RESULT };
