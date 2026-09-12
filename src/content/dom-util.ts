// DOM helpers shared by both content scripts. esbuild inlines this into each
// bundle, so it must stay free of page-specific parsing.

import type { ClickPoint } from '../util/messaging.js';
import { sleep, TIMEOUTS } from '../util/timing.js';

// Some titles carry zero-width characters (U+200B–U+200D, U+FEFF).
// Escapes keep the source pure ASCII (no invisible bytes).
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

/**
 * Strip zero-width characters and collapse all whitespace runs (including NBSP
 * and newlines from wrapped markup) to single spaces. Both sides of every title
 * comparison go through this, so a DOM title rendered with U+00A0 still equals
 * the extraction-time title it came from.
 */
export function clean(text: string | undefined | null): string {
  return (text ?? '').replace(ZERO_WIDTH_RE, '').replace(/\s+/g, ' ').trim();
}

/**
 * An element's on-screen geometry, for the background to aim a trusted click at.
 * Scrolls it into view first, so callers must only reach here once they've
 * decided a click is actually needed — this is not a free query. Coordinates are
 * viewport-relative, which is what Input.dispatchMouseEvent expects.
 */
export async function locateElement(el: HTMLElement): Promise<ClickPoint | null> {
  el.scrollIntoView({ block: 'center', inline: 'center' });
  await sleep(TIMEOUTS.SCROLL_SETTLE);
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    w: r.width,
    h: r.height,
    vw: window.innerWidth,
    vh: window.innerHeight,
  };
}
