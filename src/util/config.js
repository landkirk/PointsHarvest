export const REWARDS_URL = 'https://rewards.bing.com/';

/** @typedef {'startExtract'|'activitiesFound'|'clickCard'|'performSearch'|'start'|'stop'|'getState'|'ping'|'purgeState'|'complete'|'progress'|'debugReady'|'debugEntry'} MsgAction */
export const MSG_ACTION = /** @type {Record<string, MsgAction>} */ ({
  // Background ↔ rewards content script
  START_EXTRACT:    'startExtract',
  ACTIVITIES_FOUND: 'activitiesFound',
  CLICK_CARD:       'clickCard',
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
});

export const MIN_SEARCHES = 12;
export const MAX_SEARCHES = 17; // random target count per run

// Larger pool — shuffled each run, drawn from as needed to pad to target count.
export const GENERAL_SEARCH_POOL = [
  'latest technology news 2025',
  'best programming languages to learn 2025',
  'healthy quick dinner recipes easy',
  'beginner home workout routine no equipment',
  'best europe travel destinations summer 2025',
  'personal finance budgeting tips save money',
  'best national parks hiking trails usa',
  'roman empire history interesting facts',
  'nasa space exploration missions 2025',
  'artificial intelligence breakthroughs news',
  'best shows to stream right now 2025',
  'photography tips beginners improve photos',
  'how to learn a new language fast tips',
  'best coffee recipes to make at home',
  'yoga poses for beginners morning routine',
  'history of ancient egypt and pyramids',
  'best documentaries to watch on netflix 2025',
  'how to grow vegetables at home garden',
  'top smartphone apps for productivity 2025',
  'world news headlines today',
  'best board games for adults game night',
  'how to meditate for beginners stress relief',
  'famous landmarks to visit in europe travel',
  'best healthy snacks for weight loss',
  'how does solar energy work explained simply',
];
