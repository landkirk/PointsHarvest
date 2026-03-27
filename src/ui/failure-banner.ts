import type { Failure } from '../util/messaging.js';
import { esc } from './debug-panel.js';

// ── DOM refs ────────────────────────────────────────────────────────────────

const setupBanner = document.getElementById('setup-banner')!;
const btnOpenSettings = document.getElementById('btn-open-settings') as HTMLButtonElement;
const failureBanner = document.getElementById('failure-banner')!;
const failureSummary = document.getElementById('failure-summary')!;
const failureList = document.getElementById('failure-list')!;

// ── Setup warning banner ────────────────────────────────────────────────────

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

export function renderFailures(failures: Failure[]): void {
  if (!failures || failures.length === 0) {
    failureBanner.style.display = 'none';
    setupBanner.style.display = 'none';
    failureList.innerHTML = '';
    return;
  }
  let hasSetup = false;
  const nonSetup = failures.filter((f) => {
    if (f.category === 'setup') {
      hasSetup = true;
      return false;
    }
    return true;
  });
  setupBanner.style.display = hasSetup ? 'block' : 'none';
  if (nonSetup.length === 0) {
    failureBanner.style.display = 'none';
    failureList.innerHTML = '';
    return;
  }
  failureBanner.style.display = 'block';
  updateFailureSummary(nonSetup.length);
  failureList.innerHTML = nonSetup.map((f) => failureItemHtml(f)).join('');
}

export function appendFailure(f: Failure): void {
  if (f.category === 'setup') {
    setupBanner.style.display = 'block';
    return;
  }
  failureBanner.style.display = 'block';
  const div = document.createElement('div');
  div.innerHTML = failureItemHtml(f);
  failureList.appendChild(div.firstElementChild!);
  updateFailureSummary(failureList.children.length);
}

function failureItemHtml(f: Failure): string {
  return `<div class="failure-item"><span class="f-time">${esc(f.time)}</span><span class="f-cat">[${esc(f.category)}]</span><span class="f-msg">${esc(f.message)}</span></div>`;
}

failureSummary.addEventListener('click', () => {
  failureListExpanded = !failureListExpanded;
  failureList.style.display = failureListExpanded ? 'block' : 'none';
  updateFailureSummary(failureList.children.length);
});
