import type { RunSummary, RunEndReason } from '../util/persistent-state.js';
import { RUN_END } from '../util/persistent-state.js';
import { PHASE, PHASES, PHASES_BY_KEY, phasesByCadence } from '../util/phase.js';
import type { Cadence, PhaseKey } from '../util/phase.js';
import { formatDuration, pluralize } from '../util/format.js';

interface ActivityLineItem {
  count: number;
  singular: string;
  plural: string;
}

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

function sumPhasePointsByCadence(s: RunSummary, cadence: Exclude<Cadence, ''>): number {
  let sum = 0;
  for (const def of phasesByCadence(cadence)) {
    sum += s.phaseStates[def.key].points;
  }
  return sum;
}

function buildCard(s: RunSummary): Node[] {
  const nodes: Node[] = [];
  const weekPts = sumPhasePointsByCadence(s, 'weekly');
  const todayPts = sumPhasePointsByCadence(s, 'daily');

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
    total.textContent = `+${weekPts} weekly pts · +${todayPts} daily pts`;
  } else if (weekPts > 0) {
    total.textContent = `+${weekPts} weekly pts`;
  } else if (todayPts > 0) {
    total.textContent = `+${todayPts} daily pts`;
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
  for (const def of PHASES) {
    wrap.appendChild(buildPhaseRow(def.key, s));
  }
  return wrap;
}

function buildPhaseRow(key: PhaseKey, s: RunSummary): HTMLElement {
  const state = s.phaseStates[key];
  const progress = state.progress;
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const points = state.points;
  const isInactive = total === 0 && done === 0;

  const row = document.createElement('div');
  row.className = 'phase-row phase-row--summary';
  if (isInactive) row.classList.add('rs-phase--skipped');

  const label = document.createElement('span');
  label.className = 'phase-label';
  const name = PHASES_BY_KEY[key].label;
  label.textContent = key === PHASE.WARMUP.key && isInactive ? `${name} (skipped)` : name;
  row.appendChild(label);

  const count = document.createElement('span');
  count.className = 'phase-count';
  count.textContent = total > 0 ? `${done}/${total}` : '—';
  row.appendChild(count);

  const pts = document.createElement('span');
  pts.className = 'rs-phase-points';
  const cadence = PHASES_BY_KEY[key].cadence;
  pts.textContent = points > 0 ? `+${points} ${cadence ? `${cadence} ` : ''}pts` : '—';
  row.appendChild(pts);

  return row;
}

function buildActivityLine(s: RunSummary): HTMLElement | null {
  const { dailySetsCompleted, exploreCompleted, moreActivitiesCompleted } = s.activityCounts;
  const items: ActivityLineItem[] = [
    { count: dailySetsCompleted, singular: 'daily set card', plural: 'daily set cards' },
    { count: exploreCompleted, singular: 'explore card', plural: 'explore cards' },
    {
      count: moreActivitiesCompleted,
      singular: 'more activities tile',
      plural: 'more activities tiles',
    },
  ];
  const parts = items
    .filter((x) => x.count > 0)
    .map((x) => `${x.count} ${pluralize(x.count, x.singular, x.plural)}`);
  if (parts.length === 0) return null;
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
  const { actionableLeftover } = s.activityCounts;
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
