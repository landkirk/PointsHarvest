export const KEEPALIVE_PORT = 'keepalive';
export const REWARDS_URL = 'https://rewards.bing.com/';
/** Explore on Bing + More Activities live here, not on the home page. */
export const REWARDS_EARN_URL = 'https://rewards.bing.com/earn';
/** Same-origin JSON dashboard endpoint; source of truth for extraction/validation/counters. */
export const REWARDS_API_PATH = '/api/getuserinfo?type=1';
export const PC_SEARCH_POINTS_PER_SEARCH = 5;
/**
 * Counter `type` string: emitted by rewards-api's mapDashboardToCounters and
 * matched by farm-pc-searches' findPcCounter. One constant on both ends — the
 * lookup breaks silently if the strings ever diverge.
 */
export const PC_SEARCH_TYPE = 'pc search';
