export const KEEPALIVE_PORT = 'keepalive';
export const REWARDS_URL = 'https://rewards.bing.com/';
/** Explore on Bing + More Activities live here, not on the home page. */
export const REWARDS_EARN_URL = 'https://rewards.bing.com/earn';
export const PC_SEARCH_POINTS_PER_SEARCH = 5;
/**
 * Counter `type` string: emitted by the content script's READ_COUNTERS reply
 * and matched by farm-pc-searches' findPcCounter. One constant on both ends —
 * the lookup breaks silently if the strings ever diverge.
 */
export const PC_SEARCH_TYPE = 'pc search';
