export interface ProgressPayload {
  status?:    string;
  completed?: number;
  total?:     number;
  label?:     string;
}

export type MsgAction =
  | 'startExtract'
  | 'activitiesFound'
  | 'clickCard'
  | 'validateTile'
  | 'performSearch'
  | 'start'
  | 'stop'
  | 'getState'
  | 'ping'
  | 'purgeState'
  | 'complete'
  | 'progress'
  | 'debugReady'
  | 'debugEntry'
  | 'lingerWaiting'
  | 'userActionComplete'
  | 'getCounters';

export const MSG_ACTION: Record<string, MsgAction> = {
  // Background ↔ rewards content script
  START_EXTRACT:    'startExtract',
  ACTIVITIES_FOUND: 'activitiesFound',
  CLICK_CARD:       'clickCard',
  VALIDATE_TILE:    'validateTile',
  // Background ↔ search content script
  PERFORM_SEARCH:   'performSearch',
  // Popup → background
  START:      'start',
  STOP:       'stop',
  GET_STATE:  'getState',
  PING:       'ping',
  PURGE:      'purgeState',
  // Background/steps → popup
  COMPLETE:             'complete',
  PROGRESS:             'progress',
  DEBUG_READY:          'debugReady',
  DEBUG_ENTRY:          'debugEntry',
  LINGER_WAITING:       'lingerWaiting',
  // Popup → background
  USER_ACTION_COMPLETE: 'userActionComplete',
  // Background → rewards content script (counter extraction)
  GET_COUNTERS:         'getCounters',
};
