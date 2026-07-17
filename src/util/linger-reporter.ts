import { setLingerReporter } from './timing.js';
import { updateHeaderState } from './persistent-state.js';
import { broadcastHeader } from './context.js';

/** Mirror lingerOnPage start/end into `header.linger` and notify the popup so it
 *  can render a live "pausing" badge. Registered once from background.ts at the
 *  service-worker top level, which re-runs on every SW start.
 *
 *  Fire-and-forget is safe: the reporter callbacks run synchronously inside
 *  lingerOnPage, and enqueueWrite serializes the storage writes so the end write
 *  always lands after the matching start write. */
export function registerLingerReporter(): void {
  setLingerReporter({
    onLingerStart(label, ms) {
      void updateHeaderState(() => ({
        linger: { label, totalMs: ms, endsAt: Date.now() + ms },
      })).then(broadcastHeader);
    },
    onLingerEnd() {
      void updateHeaderState(() => ({ linger: null })).then(broadcastHeader);
    },
  });
}
