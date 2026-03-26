export interface ActivitiesResult {
  activities: Activity[];
  dailySets?: Activity[];
  loggedIn:   boolean;
}

import type { ActivityType } from './messaging.js';

export interface Activity {
  title:         string;
  description:   string;
  activityIndex: number;
  activityType?: ActivityType;
}

export interface MappedActivity extends Activity {
  query:     string | null;
  unmatched: boolean;
}

export const enum CardState {
  Actionable = 'actionable',
  Completed  = 'completed',
  Locked     = 'locked',
  Unknown    = 'unknown',
  NotFound   = 'not-found',
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

// Maps each activity to a query (may be null if none could be generated).
export function buildSearchList(activities: Activity[]): MappedActivity[] {
  return activities.map(({ title, description, activityIndex, activityType }) => {
    const query = generateSearchQuery(title, description);
    return query
      ? { title, description, activityIndex, activityType, query, unmatched: false }
      : { title, description, activityIndex, activityType, query: null, unmatched: true };
  });
}
