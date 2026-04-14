import type { PhaseKey, RunSummary, RunEndReason } from '../util/persistent-state.js';
import { PHASE, PHASE_KEYS, PHASE_LABELS, RUN_END } from '../util/persistent-state.js';
import { formatDuration, pluralize } from '../util/format.js';

const TOTAL_LABELS: Record<RunEndReason, string> = {
  [RUN_END.SUCCESS]: '',
  [RUN_END.STOPPED]: 'before you stopped',
  [RUN_END.NOT_LOGGED_IN]: 'not signed in',
  [RUN_END.FATAL]: 'run failed',
  [RUN_END.SETUP_FAILED]: 'run never started',
};

const el = document.getElementById('run-summary') as HTMLElement;
let lastRendered: RunSummary | null = null;

export function renderRunSummary(summary: RunSummary | null): void {
  if (summary === lastRendered) return;
  lastRendered = summary;
  if (!summary) {
    el.style.display = 'none';
    el.replaceChildren();
    return;
  }
  el.style.display = '';
  el.replaceChildren(...buildCard(summary));
}

function buildCard(s: RunSummary): Node[] {
  const nodes: Node[] = [];
  const weekPts = s.phasePoints[PHASE.EXPLORE];
  const todayPts = s.phasePoints[PHASE.DAILY] + s.phasePoints[PHASE.FARM];

  const header = document.createElement('div');
  header.className = 'rs-header';
  const total = document.createElement('span');
  total.className = 'rs-total';
  if (s.endReason === RUN_END.STOPPED || s.endReason === RUN_END.NOT_LOGGED_IN) {
    total.classList.add('rs-total--warn');
  } else if (s.endReason === RUN_END.FATAL || s.endReason === RUN_END.SETUP_FAILED) {
    total.classList.add('rs-total--err');
  }
  if (weekPts > 0 && todayPts > 0) {
    total.textContent = `+${weekPts} explore (wk) · +${todayPts} today`;
  } else if (weekPts > 0) {
    total.textContent = `+${weekPts} explore (wk)`;
  } else if (todayPts > 0) {
    total.textContent = `+${todayPts} today`;
  } else {
    total.textContent = '+0 pts';
  }
  header.appendChild(total);

  const labelText = TOTAL_LABELS[s.endReason];
  if (labelText) {
    const label = document.createElement('span');
    label.className = 'rs-total-label';
    label.textContent = labelText;
    header.appendChild(label);
  }
  nodes.push(header);

  const duration = formatDuration(s.endedAt - s.startedAt);
  if (duration) {
    const dur = document.createElement('div');
    dur.className = 'rs-duration';
    dur.textContent = `Finished in ${duration}`;
    nodes.push(dur);
  }

  nodes.push(buildPhases(s));

  const activityLine = buildActivityLine(s);
  if (activityLine) nodes.push(activityLine);

  const chips = buildChips(s);
  if (chips) nodes.push(chips);

  return nodes;
}

function buildPhases(s: RunSummary): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rs-phases';
  for (const key of PHASE_KEYS) {
    wrap.appendChild(buildPhaseRow(key, s));
  }
  return wrap;
}

function buildPhaseRow(key: PhaseKey, s: RunSummary): HTMLElement {
  const progress = s.phases[key];
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const points = s.phasePoints[key];
  const isInactive = total === 0 && done === 0;

  const row = document.createElement('div');
  row.className = 'phase-row phase-row--summary';
  if (isInactive) row.classList.add('rs-phase--skipped');

  const label = document.createElement('span');
  label.className = 'phase-label';
  const name = PHASE_LABELS[key];
  label.textContent = key === PHASE.WARMUP && isInactive ? `${name} (skipped)` : name;
  row.appendChild(label);

  const count = document.createElement('span');
  count.className = 'phase-count';
  count.textContent = total > 0 ? `${done}/${total}` : '—';
  row.appendChild(count);

  const pts = document.createElement('span');
  pts.className = 'rs-phase-points';
  pts.textContent = points > 0 ? `+${points} pts` : '—';
  row.appendChild(pts);

  return row;
}

function buildActivityLine(s: RunSummary): HTMLElement | null {
  const { dailySetsCompleted, exploreCompleted } = s.activityCounts;
  if (dailySetsCompleted === 0 && exploreCompleted === 0) return null;
  const parts: string[] = [];
  if (dailySetsCompleted > 0) {
    parts.push(
      `${dailySetsCompleted} ${pluralize(dailySetsCompleted, 'daily set card', 'daily set cards')}`,
    );
  }
  if (exploreCompleted > 0) {
    parts.push(
      `${exploreCompleted} ${pluralize(exploreCompleted, 'explore card', 'explore cards')}`,
    );
  }
  const line = document.createElement('div');
  line.className = 'rs-activity-line';
  line.textContent = `Completed: ${parts.join(' · ')}`;
  return line;
}

function buildChips(s: RunSummary): HTMLElement | null {
  const chips: HTMLElement[] = [];
  if (s.failureCount > 0) {
    chips.push(
      makeChip(`${s.failureCount} ${pluralize(s.failureCount, 'issue', 'issues')}`, 'rs-chip--err'),
    );
  }
  const { locked, actionableLeftover } = s.activityCounts;
  if (locked > 0) {
    chips.push(
      makeChip(
        `${locked} locked ${pluralize(locked, 'card', 'cards')} — will unlock later this week`,
        'rs-chip--warn',
      ),
    );
  }
  if (actionableLeftover > 0) {
    chips.push(
      makeChip(
        `${actionableLeftover} ${pluralize(actionableLeftover, 'activity', 'activities')} remaining`,
        'rs-chip--warn',
      ),
    );
  }
  if (chips.length === 0) return null;
  const wrap = document.createElement('div');
  wrap.className = 'rs-chips';
  for (const chip of chips) wrap.appendChild(chip);
  return wrap;
}

function makeChip(text: string, variant: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `rs-chip ${variant}`;
  chip.textContent = text;
  return chip;
}
