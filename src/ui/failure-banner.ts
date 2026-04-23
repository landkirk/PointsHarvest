import type { FailureEntry, FailureCategory } from '../util/failures.js';
import type { UserActionConfig } from '../steps/wait-for-user-action.js';
import { esc } from './debug-panel.js';

// ── DOM refs ────────────────────────────────────────────────────────────────

const actionBanner = document.getElementById('action-banner') as HTMLElement;
const actionBannerTitle = document.getElementById('action-banner-title') as HTMLElement;
const actionBannerInstructions = document.getElementById(
  'action-banner-instructions',
) as HTMLElement;
const actionBannerBtn = document.getElementById('action-banner-btn') as HTMLButtonElement;
const failureBanner = document.getElementById('failure-banner') as HTMLElement;
const failureSummary = document.getElementById('failure-summary') as HTMLElement;
const failureList = document.getElementById('failure-list') as HTMLElement;

// ── User-action banner (data-driven) ─────────────────────────────────────

let prevConfig: UserActionConfig | null = null;
let activeSuppress: FailureCategory | undefined;

export function renderActionBanner(config: UserActionConfig | null): void {
  if (config === prevConfig) return;
  prevConfig = config;
  activeSuppress = config?.failureCategory;
  if (!config) {
    actionBanner.style.display = 'none';
    return;
  }
  actionBanner.style.display = 'block';
  actionBanner.className = `theme-${config.theme}`;
  actionBannerTitle.textContent = config.bannerTitle;
  actionBannerInstructions.textContent = config.bannerInstructions;
  if (config.actionButtonUrl) {
    const url = config.actionButtonUrl;
    actionBannerBtn.style.display = '';
    actionBannerBtn.textContent = config.actionButtonLabel;
    actionBannerBtn.onclick = () => {
      chrome.tabs.create({ url }).catch(() => {
        /* non-critical: user can open manually */
      });
    };
  } else {
    actionBannerBtn.style.display = 'none';
  }
}

// ── Failure banner ─────────────────────────────────────────────────────────

let failureListExpanded = false;

function updateFailureSummary(count: number): void {
  failureSummary.textContent = `${count} failure${count === 1 ? '' : 's'} — click to ${failureListExpanded ? 'collapse' : 'expand'}`;
}

export function renderFailures(failures: FailureEntry[], suppressCategory?: FailureCategory): void {
  const displayed = (failures ?? []).filter(
    (f) => !suppressCategory || f.category !== suppressCategory,
  );
  if (displayed.length === 0) {
    failureBanner.style.display = 'none';
    failureList.innerHTML = '';
    return;
  }
  failureBanner.style.display = 'block';
  updateFailureSummary(displayed.length);
  failureList.innerHTML = displayed.map((f) => failureItemHtml(f)).join('');
  failureList.style.display = failureListExpanded ? 'block' : 'none';
}

export function appendFailure(f: FailureEntry): void {
  if (activeSuppress && f.category === activeSuppress) return;
  failureBanner.style.display = 'block';
  const div = document.createElement('div');
  div.innerHTML = failureItemHtml(f);
  failureList.appendChild(div.firstElementChild as Element);
  failureList.style.display = failureListExpanded ? 'block' : 'none';
  updateFailureSummary(failureList.children.length);
}

function failureItemHtml(f: FailureEntry): string {
  const ctxParts: [string, string][] = [];
  if (f.orchestratorName) ctxParts.push(['orch', f.orchestratorName]);
  if (f.stepName) ctxParts.push(['step', f.stepName]);
  if (f.activityTitle) ctxParts.push(['activity', f.activityTitle]);
  const ctxInner = ctxParts
    .map(([label, val]) => `<span class="f-ctx-label">${label}</span>${esc(val)}`)
    .join('<span class="f-ctx-sep"> › </span>');
  const ctxSpan = ctxInner ? `<span class="f-ctx">${ctxInner}</span>` : '';
  return `<div class="failure-item"><span class="f-time">${esc(f.time)}</span><span class="f-cat">[${esc(f.category)}]</span><span class="f-msg">${esc(f.message)}</span>${ctxSpan}</div>`;
}

failureSummary.addEventListener('click', () => {
  failureListExpanded = !failureListExpanded;
  failureList.style.display = failureListExpanded ? 'block' : 'none';
  updateFailureSummary(failureList.children.length);
});
