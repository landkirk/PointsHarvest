export const REWARDS_URL           = 'https://rewards.bing.com/';
export const REWARDS_BREAKDOWN_URL = 'https://rewards.bing.com/pointsbreakdown';

/** @typedef {'actionable'|'completed'|'locked'|'unknown'|'not-found'} CardState */
export const CARD_STATE = /** @type {Record<string, CardState>} */ ({
  ACTIONABLE: 'actionable',
  COMPLETED:  'completed',
  LOCKED:     'locked',
  UNKNOWN:    'unknown',
  NOT_FOUND:  'not-found',
});

/** @typedef {'startExtract'|'activitiesFound'|'clickCard'|'validateTile'|'performSearch'|'start'|'stop'|'getState'|'ping'|'purgeState'|'complete'|'progress'|'debugReady'|'debugEntry'} MsgAction */
export const MSG_ACTION = /** @type {Record<string, MsgAction>} */ ({
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
});

