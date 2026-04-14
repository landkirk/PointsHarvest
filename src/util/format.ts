export const LABEL_MAX = 50;

/** Returns `sing` when n === 1, otherwise `plur`. */
export function pluralize(n: number, sing: string, plur: string): string {
  return n === 1 ? sing : plur;
}

/** Truncates `s` to `max` chars, appending `…` if it was cut. */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
