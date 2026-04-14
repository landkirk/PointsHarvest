export const LABEL_MAX = 50;

/** Returns `sing` when n === 1, otherwise `plur`. */
export function pluralize(n: number, sing: string, plur: string): string {
  return n === 1 ? sing : plur;
}

/** Truncates `s` to `max` chars, appending `…` if it was cut. */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
