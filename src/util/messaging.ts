export interface ProgressPayload {
  status?: string;
  completedSearches?: number;
  totalSearches?: number;
  lastSearchString?: string;
}

export type MsgAction =
  | 'startExtract'
  | 'activitiesFound'
  | 'clickCard'
  | 'validateActivity'
  | 'performSearch'
  | 'start'
  | 'stop'
  | 'getState'
  | 'ping'
  | 'purgeState'
  | 'complete'
  | 'progress'
  | 'activitiesMapped'
  | 'debugEntry'
  | 'lingerWaiting'
  | 'userActionComplete'
  | 'getCounters'
  | 'failureEntry';

export const ACTIVITY_TYPE = {
  DAILY_SET: 'dailySet',
} as const;
export type ActivityType = (typeof ACTIVITY_TYPE)[keyof typeof ACTIVITY_TYPE];

export const MSG_ACTION: Record<string, MsgAction> = {
  // Background ↔ rewards content script
  START_EXTRACT: 'startExtract',
  ACTIVITIES_FOUND: 'activitiesFound',
  CLICK_CARD: 'clickCard',
  VALIDATE_ACTIVITY: 'validateActivity',
  // Background ↔ search content script
  PERFORM_SEARCH: 'performSearch',
  // Popup → background
  START: 'start',
  STOP: 'stop',
  GET_STATE: 'getState',
  PING: 'ping',
  PURGE: 'purgeState',
  // Background/steps → popup
  COMPLETE: 'complete',
  PROGRESS: 'progress',
  ACTIVITIES_MAPPED: 'activitiesMapped',
  DEBUG_ENTRY: 'debugEntry',
  LINGER_WAITING: 'lingerWaiting',
  // Popup → background
  USER_ACTION_COMPLETE: 'userActionComplete',
  // Background → rewards content script (counter extraction)
  GET_COUNTERS: 'getCounters',
  FAILURE_ENTRY: 'failureEntry',
};
