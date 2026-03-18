import type { OnboardingScreen } from '../util/screens.js';
import { setState, loadState } from '../util/state.js';

export async function showOnboarding(
  screens: OnboardingScreen[],
  onComplete: () => void,
): Promise<void> {
  // Fetch and inject the overlay markup
  const res  = await fetch(chrome.runtime.getURL('ui/onboarding.html'));
  const html = await res.text();
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);

  const overlay     = document.getElementById('onboarding-overlay')!;
  const titleEl     = overlay.querySelector<HTMLElement>('.ob-title')!;
  const bodyEl      = overlay.querySelector<HTMLElement>('.ob-body')!;
  const counterEl   = overlay.querySelector<HTMLElement>('.ob-step-counter')!;
  const dotsEl      = overlay.querySelector<HTMLElement>('.ob-dots')!;
  const backBtn     = document.getElementById('ob-back') as HTMLButtonElement;
  const nextBtn     = document.getElementById('ob-next') as HTMLButtonElement;

  let current = 0;

  async function render(): Promise<void> {
    const screen = screens[current];
    const total  = screens.length;

    titleEl.textContent   = screen.title;
    counterEl.textContent = `${current + 1} / ${total}`;
    bodyEl.innerHTML      = await fetch(chrome.runtime.getURL(screen.bodyFile)).then(r => r.text());

    // Dots
    dotsEl.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('span');
      dot.className = 'ob-dot' + (i < current ? ' done' : i === current ? ' active' : '');
      dotsEl.appendChild(dot);
    }

    backBtn.disabled = current === 0;

    const isLast = current === total - 1;
    nextBtn.textContent = isLast ? 'Finish' : 'Next →';
    nextBtn.classList.toggle('finish', isLast);
  }

  backBtn.addEventListener('click', async () => {
    if (current > 0) { current--; await render(); }
  });

  nextBtn.addEventListener('click', async () => {
    if (current < screens.length - 1) {
      current++;
      await render();
    } else {
      // Save all shown screen IDs
      const state = await loadState();
      const merged = Array.from(new Set([...state.seenScreenIds, ...screens.map(s => s.id)]));
      await setState({ seenScreenIds: merged });

      overlay.classList.remove('active');
      wrap.remove();
      onComplete();
    }
  });

  overlay.classList.add('active');
  await render();
}
