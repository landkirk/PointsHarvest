import type { FailureEntry } from '../util/failures.js';
import { FAIL } from '../util/failures.js';
import { esc } from './debug-panel.js';

// ── DOM refs ────────────────────────────────────────────────────────────────

const permissionBanner = document.getElementById('permission-banner') as HTMLElement;
const btnOpenSettings = document.getElementById('btn-open-settings') as HTMLButtonElement;
const failureBanner = document.getElementById('failure-banner') as HTMLElement;
const failureSummary = document.getElementById('failure-summary') as HTMLElement;
const failureList = document.getElementById('failure-list') as HTMLElement;

// ── Permission warning banner ──────────────────────────────────────────────

btnOpenSettings.addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://settings/content/popups' }).catch(() => {
    /* non-critical: user can open settings manually */
  });
});

// ── Failure banner ─────────────────────────────────────────────────────────

let failureListExpanded = false;

function updateFailureSummary(count: number): void {
  failureSummary.textContent = `${count} failure${count === 1 ? '' : 's'} — click to ${failureListExpanded ? 'collapse' : 'expand'}`;
}

export function renderFailures(failures: FailureEntry[]): void {
  if (!failures || failures.length === 0) {
    failureBanner.style.display = 'none';
    permissionBanner.style.display = 'none';
    failureList.innerHTML = '';
    return;
  }
  let hasPermission = false;
  const nonPermission = failures.filter((f) => {
    if (f.category === FAIL.PERMISSION) {
      hasPermission = true;
      return false;
    }
    return true;
  });
  permissionBanner.style.display = hasPermission ? 'block' : 'none';
  if (nonPermission.length === 0) {
    failureBanner.style.display = 'none';
    failureList.innerHTML = '';
    return;
  }
  failureBanner.style.display = 'block';
  updateFailureSummary(nonPermission.length);
  failureList.innerHTML = nonPermission.map((f) => failureItemHtml(f)).join('');
  failureList.style.display = failureListExpanded ? 'block' : 'none';
}

export function appendFailure(f: FailureEntry): void {
  if (f.category === FAIL.PERMISSION) {
    permissionBanner.style.display = 'block';
    return;
  }
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
