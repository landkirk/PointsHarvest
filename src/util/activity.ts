import { VALIDATION_RETRY_QUERIES } from './search-queries.js';

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

export interface ExtractionResult {
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

export interface MappedActivity extends Activity {
  query: string | null;
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

// Maps each activity to a query (may be null if none could be generated).
export function buildSearchList(activities: Activity[]): MappedActivity[] {
  return activities.map(({ id, title, description, activityType, cardState, points }) => {
    const query = generateSearchQuery(title, description);
    return query
      ? { id, title, description, activityType, cardState, points, query }
      : { id, title, description, activityType, cardState, points, query: null };
  });
}
