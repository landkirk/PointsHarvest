import { VALIDATION_RETRY_QUERIES } from './search-queries.js';
import { TIMEOUTS } from './timing.js';
import { loadRunState, setRunState } from './persistent-state.js';
import { ACTIVITY_TYPE, CARD_SOURCE, CardState } from './activity-types.js';
import type { Activity, ActivityType, RawCard, UserActionKind } from './activity-types.js';

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
  'bing app',
  'set a goal',
];

/**
 * Classify a raw card into an ActivityType from its source.
 *
 * `source` is decided by whoever built the card and is trusted here. The API
 * mapper (`rewards-api.ts`) already resolves explore via `isExplorePromo()`,
 * which reads both the promo `name` and `attributes.offerid` — re-deriving that
 * here from `promoName` alone silently dropped any promo marked only by its
 * offer id, because `RawCard` never carried the offer id to re-check.
 */
export function classifyCard(card: RawCard): ActivityType {
  const combined = `${card.title} ${card.description}`.toLowerCase();
  if (CARD_IGNORE_STRINGS.some((s) => combined.includes(s))) return ACTIVITY_TYPE.IGNORED;

  switch (card.source) {
    case CARD_SOURCE.DAILY_SET:
      return ACTIVITY_TYPE.DAILY_SET;
    case CARD_SOURCE.EXPLORE:
      return ACTIVITY_TYPE.EXPLORE_ON_BING;
    case CARD_SOURCE.MORE_ACTIVITIES:
      // Zero-point promos are banners/campaigns, not earnable activities.
      if (card.points === 0) return ACTIVITY_TYPE.IGNORED;
      if (MORE_ACTIVITIES_IGNORE_STRINGS.some((s) => combined.includes(s))) {
        return ACTIVITY_TYPE.IGNORED;
      }
      return ACTIVITY_TYPE.MORE_ACTIVITIES;
    default:
      return ACTIVITY_TYPE.IGNORED;
  }
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
    (acc: { count: number; points: number }, a: Activity) => {
      if (a.cardState === CardState.Completed) {
        acc.count++;
        acc.points += a.points;
      }
      return acc;
    },
    { count: 0, points: 0 },
  );
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

export async function markActivityCompleted(activityId: string): Promise<void> {
  const run = await loadRunState();
  const activityState = run.activityState;
  if (!activityState) return;
  const activity = activityState.allActivities.find((a: Activity) => a.id === activityId);
  if (activity) {
    activity.cardState = CardState.Completed;
    await setRunState({ activityState });
  }
}
