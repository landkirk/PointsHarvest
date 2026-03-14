import { dbg } from './debug.js';

/** Triangular distribution biased toward the middle of [min, max]. */
export function randMs(min, max) {
  return Math.round(min + ((Math.random() + Math.random()) / 2) * (max - min));
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Dwell on a page for a random 5–7s and log it. */
export async function lingerOnPage(label = 'page') {
  const ms = randMs(5000, 7000);
  await dbg('info', `Lingering on ${label} for ${(ms / 1000).toFixed(1)}s`);
  await sleep(ms);
}
