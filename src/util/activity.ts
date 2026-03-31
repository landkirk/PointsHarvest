import { VALIDATION_RETRY_QUERIES } from './search-queries.js';
import { loadState, setState } from './state.js';

export const ACTIVITY_TYPE = {
  DAILY_SET: 'dailySet',
  EXPLORE_ON_BING: 'exploreOnBing',
  IGNORED: 'ignored',
} as const;
export type ActivityType = (typeof ACTIVITY_TYPE)[keyof typeof ACTIVITY_TYPE];

export const CARD_SOURCE = {
  EXPLORE: 'explore',
  DAILY_SET: 'dailySet',
} as const;
export type CardSource = (typeof CARD_SOURCE)[keyof typeof CARD_SOURCE];

export interface ActivityState {
  allActivities: Activity[];
  loggedIn: boolean;
  rewardsTabId: number | null;
  alreadyCompletedCount: number;
  dailyAlreadyCompletedCount: number;
  alreadyCompletedPoints: number;
  dailyAlreadyCompletedPoints: number;
}

export interface Activity {
  id: string;
  title: string;
  description: string;
  activityType: ActivityType;
  cardState: CardState;
  points: number;
  searchQuery?: string | null;
  fallbackQuery?: string | null;
  requiresUserAction: boolean;
  userActionTimeoutMs: number;
}

/** Raw card data sent from content script before classification. */
export interface RawCard {
  id: string;
  title: string;
  description: string;
  points: number;
  cardState: CardState;
  source: CardSource;
  /** Parent data-bi-id attribute, used for explore-on-bing classification. */
  dataBiId: string;
}

const EXPLORE_ON_BING_RE = /search (?:on|using|with) bing/i;

/** Classify a raw card into an ActivityType based on source and heuristics. */
export function classifyCard(card: RawCard): ActivityType {
  if (card.source === CARD_SOURCE.DAILY_SET) return ACTIVITY_TYPE.DAILY_SET;
  if (
    EXPLORE_ON_BING_RE.test(card.title) ||
    EXPLORE_ON_BING_RE.test(card.description) ||
    card.dataBiId.includes('exploreonbing')
  ) {
    return ACTIVITY_TYPE.EXPLORE_ON_BING;
  }
  return ACTIVITY_TYPE.IGNORED;
}

export const enum CardState {
  Actionable = 'actionable',
  Completed = 'completed',
  Locked = 'locked',
  Unknown = 'unknown',
  NotFound = 'not-found',
}

// Strips the "Search on Bing to/for …" boilerplate that appears in most activity
// descriptions and returns the remainder as a usable search query.
// If the description is unhelpful, falls back to the title text.
// Descriptions shorter than this are usually too generic after boilerplate is stripped
const MIN_QUERY_LENGTH = 8;

const BOILERPLATE = [
  /^search on bing (?:to |for )?/i,
  /^search using bing (?:to |for )?/i,
  /^search bing (?:to |for )?/i,
  /^use bing to /i,
  /^bing search (?:to |for )?/i,
];

function generateSearchQuery(title: string, description: string): string {
  let base = (description || '').trim();
  for (const re of BOILERPLATE) {
    base = base.replace(re, '').trim();
  }
  if (base.length < MIN_QUERY_LENGTH) base = (title || '').trim();
  return base.slice(0, 80).trim();
}

export function findRetryQuery(query: string): string | null {
  return VALIDATION_RETRY_QUERIES.find(({ pattern }) => pattern.test(query))?.retryQuery ?? null;
}

export async function markActivityCompleted(activityId: string): Promise<void> {
  const state = await loadState();
  const activityState = state.activityState;
  if (!activityState) return;

  const activity = activityState.allActivities.find((a) => a.id === activityId);
  if (activity) {
    activity.cardState = CardState.Completed;
    await setState({ activityState });
  }
}

const USER_ACTION_RE = /\b(quiz|poll|test|puzzle)\b/i;
const POLL_TIMEOUT_MS = 2 * 60 * 1000; // 2 min — poll is a single click
const QUIZ_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — quiz/test/puzzle

/** Enriches each activity with user-action metadata derived from its title/description. */
export function enrichUserActions(activities: Activity[]): Activity[] {
  for (const activity of activities) {
    const needsAction =
      USER_ACTION_RE.test(activity.title) || USER_ACTION_RE.test(activity.description);
    const isPoll =
      needsAction && (/\bpoll\b/i.test(activity.title) || /\bpoll\b/i.test(activity.description));
    activity.requiresUserAction = needsAction;
    activity.userActionTimeoutMs = needsAction ? (isPoll ? POLL_TIMEOUT_MS : QUIZ_TIMEOUT_MS) : 0;
  }
  return activities;
}

/** Enriches each activity with a generated search query and fallback query (may be null if none could be generated). */
export function enrichSearchQueries(activities: Activity[]): Activity[] {
  for (const activity of activities) {
    const q = generateSearchQuery(activity.title, activity.description);
    activity.searchQuery = q || null;
    activity.fallbackQuery = q ? findRetryQuery(q) : null;
  }
  return activities;
}
