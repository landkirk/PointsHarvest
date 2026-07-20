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

import type { ActivityType, RawCard, SectionKey } from './activity-types.js';
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
} as const;
export type ControlKind = (typeof CONTROL_KIND)[keyof typeof CONTROL_KIND];

export const LOCATE_STATUS = {
  /** Found, and it needs clicking — `point` is valid. */
  Ready: 'ready',
  /** Nothing to click: already in the target state. */
  Satisfied: 'satisfied',
  /** No such element. */
  Absent: 'absent',
} as const;
export type LocateStatus = (typeof LOCATE_STATUS)[keyof typeof LOCATE_STATUS];

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
 * Reply to GET_COUNTERS. `read` separates "dashboard unreadable — worth polling
 * again" from "read fine; `searchCounters` is the definitive answer, empty
 * included". Without it an account with no live PC counter is indistinguishable
 * from a failed fetch and burns the caller's whole poll budget.
 */
export interface CountersResponse {
  read: boolean;
  searchCounters: { type: string; current: number; max: number }[];
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
  START_EXTRACT: 'startExtract',
  ACTIVITIES_FOUND: 'activitiesFound',
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
  GET_COUNTERS: 'getCounters',
  FAILURE_ENTRY: 'failureEntry',
} as const;

export type MsgAction = (typeof MSG_ACTION)[keyof typeof MSG_ACTION];

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
  | { action: typeof MSG_ACTION.START_EXTRACT }
  | {
      action: typeof MSG_ACTION.ACTIVITIES_FOUND;
      cards: RawCard[];
      loggedIn: boolean;
      // When `loggedIn` is false, why the content script concluded that — surfaced
      // in the debug log so a signed-in user misreported as logged-out is diagnosable.
      reason?: string;
    }
  | {
      action: typeof MSG_ACTION.LOCATE_CARD;
      title: string;
      destinationUrl: string;
      promoName: string;
      /** Scopes card lookup to this activity's section — see sectionForActivityType. */
      activityType: ActivityType;
    }
  | {
      action: typeof MSG_ACTION.LOCATE_CONTROL;
      control: ControlKind;
      sectionKey: SectionKey;
    }
  | { action: typeof MSG_ACTION.VALIDATE_ACTIVITY; promoName: string }
  | { action: typeof MSG_ACTION.GET_COUNTERS }
  // Background → Search content script
  | { action: typeof MSG_ACTION.PERFORM_SEARCH; query: string }
  | { action: typeof MSG_ACTION.SCROLL_PAGE; y: number; behavior: 'smooth' | 'instant' }
  | { action: typeof MSG_ACTION.CLICK_RESULT };
