import { VALIDATION_RETRY_QUERIES } from './search-queries.js';

export const ACTIVITY_TYPE = {
  DAILY_SET: 'dailySet',
} as const;
export type ActivityType = (typeof ACTIVITY_TYPE)[keyof typeof ACTIVITY_TYPE];

export interface ActivitiesResult {
  activities: Activity[];
  dailySets: Activity[];
  loggedIn: boolean;
  alreadyCompletedCount: number;
  dailyAlreadyCompletedCount: number;
  alreadyCompletedPoints: number;
  dailyAlreadyCompletedPoints: number;
}

export interface Activity {
  id: string;
  title: string;
  description: string;
  activityType?: ActivityType;
  points: number;
}

export interface MappedActivity extends Activity {
  query: string | null;
  unmatched: boolean;
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
  return activities.map(({ id, title, description, activityType, points }) => {
    const query = generateSearchQuery(title, description);
    return query
      ? { id, title, description, activityType, points, query, unmatched: false }
      : { id, title, description, activityType, points, query: null, unmatched: true };
  });
}
