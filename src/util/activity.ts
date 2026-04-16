import { VALIDATION_RETRY_QUERIES } from './search-queries.js';
import { loadRunState, setRunState } from './persistent-state.js';
import { TIMEOUTS } from './timing.js';

export const ACTIVITY_TYPE = {
  DAILY_SET: 'dailySet',
  EXPLORE_ON_BING: 'exploreOnBing',
  MORE_ACTIVITIES: 'moreActivities',
  IGNORED: 'ignored',
} as const;
export type ActivityType = (typeof ACTIVITY_TYPE)[keyof typeof ACTIVITY_TYPE];

export const CARD_SOURCE = {
  EXPLORE: 'explore',
  DAILY_SET: 'dailySet',
  MORE_ACTIVITIES: 'moreActivities',
} as const;
export type CardSource = (typeof CARD_SOURCE)[keyof typeof CARD_SOURCE];

export interface ActivityState {
  allActivities: Activity[];
  loggedIn: boolean;
  rewardsTabId: number | null;
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
  userActionKind: UserActionKind | null;
  userActionTimeoutMs: number;
}

export type UserActionKind = 'quiz' | 'poll' | 'puzzle';

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
const CARD_IGNORE_STRINGS = ['share', 'referral'];
const MORE_ACTIVITIES_IGNORE_STRINGS = [
  'puzzle',
  'quiz',
  'browser extension',
  'set bing',
  'install',
  'play',
  'test',
  'search more',
];

/** Classify a raw card into an ActivityType based on source and heuristics. */
export function classifyCard(card: RawCard): ActivityType {
  const combined = `${card.title} ${card.description}`.toLowerCase();
  if (CARD_IGNORE_STRINGS.some((s) => combined.includes(s))) return ACTIVITY_TYPE.IGNORED;
  if (card.source === CARD_SOURCE.DAILY_SET) return ACTIVITY_TYPE.DAILY_SET;
  if (card.source === CARD_SOURCE.MORE_ACTIVITIES) {
    if (MORE_ACTIVITIES_IGNORE_STRINGS.some((s) => combined.includes(s))) {
      return ACTIVITY_TYPE.IGNORED;
    }
    return ACTIVITY_TYPE.MORE_ACTIVITIES;
  }
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

export function sumCompleted(activities: Activity[]): { count: number; points: number } {
  return activities.reduce(
    (acc, a) => {
      if (a.cardState === CardState.Completed) {
        acc.count++;
        acc.points += a.points;
      }
      return acc;
    },
    { count: 0, points: 0 },
  );
}

export async function markActivityCompleted(activityId: string): Promise<void> {
  const run = await loadRunState();
  const activityState = run.activityState;
  if (!activityState) return;

  const activity = activityState.allActivities.find((a) => a.id === activityId);
  if (activity) {
    activity.cardState = CardState.Completed;
    await setRunState({ activityState });
  }
}

const USER_ACTION_RE = /\b(quiz|poll|test|puzzle)\b/i;

function detectUserActionKind(activity: Activity): UserActionKind | null {
  const match = activity.title.match(USER_ACTION_RE) ?? activity.description.match(USER_ACTION_RE);
  if (!match) return null;
  const word = match[1].toLowerCase();
  // "test your knowledge" cards are quizzes — fold test → quiz for display
  if (word === 'test') return 'quiz';
  return word as UserActionKind;
}

export function enrichUserActions(activities: Activity[]): Activity[] {
  for (const activity of activities) {
    const kind = detectUserActionKind(activity);
    activity.requiresUserAction = kind !== null;
    activity.userActionKind = kind;
    activity.userActionTimeoutMs =
      kind === null ? 0 : kind === 'poll' ? TIMEOUTS.USER_ACTION_POLL : TIMEOUTS.USER_ACTION_QUIZ;
  }
  return activities;
}

export function enrichSearchQueries(activities: Activity[]): Activity[] {
  for (const activity of activities) {
    const q = generateSearchQuery(activity.title, activity.description);
    activity.searchQuery = q || null;
    activity.fallbackQuery = q ? findRetryQuery(q) : null;
  }
  return activities;
}
