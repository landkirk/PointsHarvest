/** Returns `sing` when n === 1, otherwise `plur`. */
export function pluralize(n: number, sing: string, plur: string): string {
  return n === 1 ? sing : plur;
}
