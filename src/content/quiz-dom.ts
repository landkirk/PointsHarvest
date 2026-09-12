// DOM parsing for the Microsoft Rewards quiz and poll modules.
//
// Neither lives on rewards.bing.com: clicking a daily-set quiz or poll tile
// lands on a normal Bing SERP whose whole-page-template carries the module. That
// is why this is read by the *search* content script — https://www.bing.com/*
// already matches it, so no new content script, match pattern, or host
// permission is involved.
//
// These are unrelated markup families — Bing ships several and keeps adding more
// — so everything below is table-driven off MODULES rather than hardcoding one
// shape. Adding a family is one row (verified against captured markup, Sept
// 2026):
//
//   Quiz, daily-set variant — multi-question, carries its own "1/3" progress label
//   .btom_card                                         (in #b_wpt_container_ml)
//   ├── .btom_quest                                    question text
//   ├── .btom_opts
//   │   └── acf-button-standard.btom_opt[data-is-ready]
//   │       └── a.acf-button-standard__link[title][href]
//   └── .btom_foot .btq_prog .btq_lbl                  "1/3"
//
//   Quiz, Copilot-Search variant ("Bing news quiz") — same idea, different
//   prefix, and note it renders into #b_wpt_container, *not* the _ml one. The
//   wrapper is .btq_main; .btq_card inside it holds only header + question.
//   .btq_main                                          (in #b_wpt_container)
//   ├── .btq_card
//   │   ├── .btq_hdr .btq_title                        "Bing news quiz"
//   │   └── .btq_quest                                 question text
//   ├── .btq_opts .btq_row
//   │   └── acf-button-standard.btq_opt[data-index][data-is-ready]
//   │       └── a.acf-button-standard__link[title][href]
//   └── .btq_foot .btq_prog .btq_lbl                   "1/3"
//
//   Quiz, .btq_main *between* questions — this family does not go straight from
//   one question to the next. Answering re-renders .btq_main into a visible
//   answer reveal plus the next question's card, hidden, and it only moves on
//   when the reveal's footer button is clicked:
//   .btq_main
//   ├── .btq_card.btq_ansP                             the reveal (visible)
//   │   └── .btq_hdr
//   │       ├── .btq_ansTtl                            the question just answered
//   │       ├── .btq_answer .btq_ansItem               .btq_correct / .btq_wrong
//   │       ├── .btq_info                              explanation prose
//   │       └── .btq_ansRow.btq_stat                   "34% got this right"
//   ├── .btq_foot
//   │   └── acf-button-standard.btq_nxtQues
//   │       └── button[title="Next"]                   the advance control
//   └── .btq_card.btq_quesP.btq_hideCompulsary         next question, hidden
//       ├── .btq_quest, .btq_opts                      hidden until Next is clicked
//       └── .btq_foot .btq_prog .btq_lbl               "2/3" — the *coming* question
//
//   Quiz, .btq_main *after the last question* — clicking Next on the final
//   reveal replaces the cards with a score summary, and the option container is
//   gone entirely. Its links go elsewhere on purpose ("Explore next quiz" starts
//   a *different* quiz, the other two leave for an external page), which is why
//   the advance lookup matches an exact "Next" and nothing looser.
//   .btq_main
//   └── .btq_card.btq_sumP                             the summary (played evidence)
//       └── .btq_hdr
//           ├── .btq_sumTtl                            "You got 0 of 3 correct."
//           └── .btq_sum .btq_links
//               └── acf-button-standard.btq_sumPromoLink > a
//                   (.btq_playNxtQuz | .btq_exploreEntity | .btq_exploreRew)
//
//   Two consequences, both load-bearing: the hidden card means every read has to
//   be visibility-filtered (its options are real anchors, just not on screen),
//   and the only progress label in the card during the reveal belongs to the
//   question that hasn't been shown yet — so progress is not comparable across a
//   Next click.
//
//   Poll — single question, no progress label; answering swaps the choices for a
//   results view (percentage bars) instead of advancing
//   .btp_card
//   ├── .btp_header .btp_title                         "Microsoft Rewards Poll"
//   └── .btp_content
//       ├── .btp_quest .btp_q_text                     question text
//       └── .btp_choices .btp_row
//           └── .btp_choice_wrapper(.btp_voted|.btp_not_voted)
//               └── acf-button-standard.btp_choice[data-optionid][data-is-ready]
//                   └── a.acf-button-standard__link[title][href]
//
// In all of them, an option is a real <a target="_self"> to another SERP URL, so
// answering *navigates* the tab rather than updating in place. The module
// re-renders from scratch each time, which is why the caller re-locates after
// every click instead of holding element references.

import type { QuizEndState, QuizKind, QuizProgress } from '../util/messaging.js';
import { clean } from './dom-util.js';

interface ModuleShape {
  readonly kind: QuizKind;
  readonly card: string;
  readonly question: string;
  /** The container every option lookup is scoped to. */
  readonly options: string;
  /** Progress label ("1/3"), when the module reports its own length. */
  readonly progress: string | null;
  /**
   * Evidence the module is played *and finished*, when it stays on screen
   * afterwards — the poll's results view, the quiz's score summary. The poll's
   * results view keeps rendering clickable-looking choices, so without this the
   * loop would vote again on every round.
   *
   * Matched on screen only: these families leave earlier cards in the DOM behind
   * a hide class, and a hidden match is a leftover, not evidence. Matching one
   * would report a live question as finished and never answer it.
   */
  readonly answered: string | null;
}

const MODULES: readonly ModuleShape[] = [
  {
    kind: 'quiz',
    card: '.btom_card',
    question: '.btom_quest',
    options: '.btom_opts',
    progress: '.btq_lbl',
    answered: null,
  },
  {
    kind: 'quiz',
    // The Copilot-Search variant ("Bing news quiz"). `.btq_main` is the wrapper —
    // `.btq_card` inside it holds only the header and question, not the options.
    card: '.btq_main',
    question: '.btq_quest',
    options: '.btq_opts',
    progress: '.btq_lbl',
    // The score summary that replaces the questions once the last one is
    // answered. Unlike the reveal it is terminal, so it is the module saying it
    // is played — which is what stops the caller polling for a question that is
    // never coming, and what keeps an already-finished quiz from being handed
    // back to the user as unrecognized markup.
    answered: '.btq_sumP',
  },
  {
    kind: 'poll',
    card: '.btp_card',
    question: '.btp_q_text',
    options: '.btp_choices',
    progress: null,
    answered: '.btp_voted, .btp_percentage, .btp_selected',
  },
];

/**
 * The whole-page-template regions the modules render into. Two ids, because the
 * Copilot-Search quiz variant renders into `#b_wpt_container` while the others
 * use `#b_wpt_container_ml` — and a module found in neither still falls back to
 * a document-wide lookup, since the card selectors are specific enough to stand
 * on their own.
 */
const CONTAINER = '#b_wpt_container_ml, #b_wpt_container';

/**
 * Option lookup tiers, scoped to the module's own options container on purpose:
 * the same card renders the Feedback like/dislike links (`.fdbk_thmb_root`), and
 * a document-wide structural fallback could aim a trusted click at an unrelated
 * SERP link. A miss here costs nothing — the caller falls back to asking the
 * user — whereas a mis-aimed click navigates away from the activity entirely.
 */
const OPTION_TIERS: readonly { via: string; selector: string }[] = [
  { via: 'option-anchor', selector: '.btom_opt a[href], .btq_opt a[href], .btp_choice a[href]' },
  { via: 'scoped-anchor', selector: 'a[href]' },
  { via: 'scoped-role-button', selector: '[role="button"], button' },
];

/**
 * Advance-control lookup tiers for the reveal panel that sits between questions.
 * Scoped to the card (the control lives in the card's own footer, outside the
 * options container) and only ever consulted when no option is clickable, so it
 * cannot pre-empt an answer.
 *
 * The class tier is the verified one; the labelled tier is what covers a family
 * whose reveal markup we haven't captured, and is deliberately strict — an exact
 * "Next" on the element's own title, aria-label, or text — because a looser match
 * inside a SERP card could aim a trusted click at something else. It is
 * en-US-only by nature; a localized page falls back to the class tier, and a miss
 * costs nothing worse than handing the quiz back to the user.
 */
const NEXT_TIERS: readonly { via: string; selector: string; labelled: boolean }[] = [
  { via: 'next-control', selector: '.btq_nxtQues button, .btq_nxtQues a[href]', labelled: false },
  { via: 'next-labelled', selector: 'button, [role="button"], a[href]', labelled: true },
];

export interface QuizModule {
  card: HTMLElement;
  shape: ModuleShape;
}

/**
 * The quiz or poll module on the current SERP, or null when this isn't one.
 *
 * Looks inside the whole-page-template container first, then retries across the
 * whole document: Bing keeps introducing container variants (`_ml` vs the
 * Copilot-Search one), and a container that exists but doesn't hold the module
 * must not shadow a module rendered elsewhere.
 */
export function findQuizCard(): QuizModule | null {
  const container = document.querySelector<HTMLElement>(CONTAINER);
  const scopes: ParentNode[] = container ? [container, document] : [document];
  for (const scope of scopes) {
    for (const shape of MODULES) {
      const card = scope.querySelector<HTMLElement>(shape.card);
      if (card) return { card, shape };
    }
  }
  return null;
}

/**
 * The clickable answer options, plus the tier that found them.
 *
 * Returns the inner anchor rather than the `acf-button-standard` wrapper: the
 * anchor carries the href and fills the button, so its rect is what a real
 * cursor would land on.
 *
 * Empty for an already-answered module — the caller reads that as "nothing left
 * to do", which for a single-question poll means it is finished. `state` (null
 * whenever options were found) says which of the ways that happened — see
 * `QuizEndState`.
 */
export function quizOptions({ card, shape }: QuizModule): {
  options: HTMLElement[];
  via: string;
  state: QuizEndState | null;
} {
  if (shape.answered && findRendered(card, shape.answered)) {
    return { options: [], via: 'already-answered', state: 'finished' };
  }

  const scope = card.querySelector<HTMLElement>(shape.options);
  if (!scope) return { options: [], via: 'no-options-container', state: 'unparsed' };

  // Options that exist and are laid out but read disabled: the quiz shape has no
  // `answered` selector of its own, so this locked state is its only "played"
  // evidence — both between questions and after the final answer.
  let disabled = false;

  for (const tier of OPTION_TIERS) {
    const rendered = Array.from(scope.querySelectorAll<HTMLElement>(tier.selector)).filter(
      isRendered,
    );
    const found = rendered.filter(isEnabled);
    if (found.length === 0) {
      if (rendered.length > 0) disabled = true;
      continue;
    }
    // `data-is-ready` marks a hydrated option. Prefer those when any are
    // marked, but never hard-require it — it's a hydration hint, not a
    // contract, and an unmarked option is still clickable.
    const ready = found.filter((el) => el.closest('[data-is-ready]') !== null);
    const options = ready.length > 0 ? ready : found;
    return { options, via: ready.length > 0 ? `${tier.via}+ready` : tier.via, state: null };
  }
  return disabled
    ? { options: [], via: 'all-disabled', state: 'disabled' }
    : { options: [], via: 'no-options', state: 'unparsed' };
}

/** First on-screen match — a hidden one is a leftover card, not live markup. */
function findRendered(scope: ParentNode, selector: string): HTMLElement | null {
  for (const el of scope.querySelectorAll<HTMLElement>(selector)) {
    if (isRendered(el)) return el;
  }
  return null;
}

/**
 * On screen — a zero-rect option is one we can't aim a click at.
 *
 * The rect test alone is not enough here: between questions `.btq_main` keeps the
 * next question's card in the DOM (`.btq_hideCompulsary`) with its option anchors
 * intact, and clicking one of those would answer a question the page has not
 * shown yet. `checkVisibility` is what rules out a hidden ancestor; it is
 * optional-called so an older Chrome falls back to the rect test rather than
 * throwing.
 */
function isRendered(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  return el.checkVisibility?.({ checkVisibilityCSS: true, visibilityProperty: true }) !== false;
}

/**
 * Not explicitly disabled — a disabled option is already-answered state.
 *
 * Walks a few levels up from the anchor because that is not where the flags
 * live: `aria-disabled`/`disabled` sit on the `acf-button-standard` wrapper,
 * while the element we return (and click) is the inner anchor filling it.
 */
function isEnabled(el: HTMLElement): boolean {
  let n: HTMLElement | null = el;
  for (let depth = 0; n && depth < 3; n = n.parentElement, depth++) {
    if (n.getAttribute('aria-disabled') === 'true') return false;
    if (n.hasAttribute('disabled')) return false;
  }
  return true;
}

/**
 * The control that advances past an answer reveal, or null when the module isn't
 * showing one. Callers ask only after `quizOptions` comes back empty: an
 * answerable question always wins, so this can never divert a click away from
 * one.
 *
 * Polls are excluded outright — a vote is the whole activity, and its results
 * view has nothing to advance to.
 */
export function quizNext({ card, shape }: QuizModule): { el: HTMLElement; via: string } | null {
  if (shape.kind !== 'quiz') return null;
  for (const tier of NEXT_TIERS) {
    for (const el of card.querySelectorAll<HTMLElement>(tier.selector)) {
      if (!isRendered(el) || !isEnabled(el)) continue;
      if (tier.labelled && !isNextLabel(el)) continue;
      return { el, via: tier.via };
    }
  }
  return null;
}

/** Exactly "Next" on the element's own title, aria-label, or text. */
function isNextLabel(el: HTMLElement): boolean {
  const labels = [el.getAttribute('title'), el.getAttribute('aria-label'), el.textContent];
  return labels.some((l) => clean(l).toLowerCase() === 'next');
}

/**
 * The quiz's "1/3" progress label. Bounds the answer loop and tells the caller
 * how far along it is. Null for polls (single question, no label) and whenever
 * the label is missing or unparseable, in which case the caller falls back to
 * its own round cap.
 *
 * While a reveal panel is up this reads the *next* question's number, since that
 * is the only label in the card — see the header block. Comparing it across a
 * Next click therefore proves nothing, which is why the caller stops comparing
 * once it has clicked one.
 */
export function quizProgress({ card, shape }: QuizModule): QuizProgress | null {
  if (!shape.progress) return null;
  const label = clean(card.querySelector(shape.progress)?.textContent);
  const m = /(\d+)\s*\/\s*(\d+)/.exec(label);
  if (!m) return null;
  const current = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return null;
  return { current, total };
}

/** The question text — debug-log detail only, never a selector input. */
export function quizQuestion({ card, shape }: QuizModule): string | null {
  return clean(card.querySelector(shape.question)?.textContent) || null;
}
