import { REWARDS_URL, REWARDS_EARN_URL } from './config.js';

export const ACTIVITY_TYPE = {
  DAILY_SET: 'dailySet',
  EXPLORE_ON_BING: 'exploreOnBing',
  MORE_ACTIVITIES: 'moreActivities',
  IGNORED: 'ignored',
} as const;
export type ActivityType = (typeof ACTIVITY_TYPE)[keyof typeof ACTIVITY_TYPE];

export const CARD_SOURCE = {
  EXPLORE: 'explore',
  DAILY_SET: 'dailySet',
  MORE_ACTIVITIES: 'moreActivities',
} as const;
export type CardSource = (typeof CARD_SOURCE)[keyof typeof CARD_SOURCE];

export const enum CardState {
  Actionable = 'actionable',
  Completed = 'completed',
  Locked = 'locked',
  NotFound = 'not-found',
}

export type UserActionKind = 'quiz' | 'poll' | 'puzzle';

/**
 * A section of the rewards page: where its cards live, and how to find the
 * disclosure toggle that gates them.
 *
 * Shape only — `SectionDescriptor` below is the type to use, derived from the
 * table so `key` carries its literal type rather than a bare string.
 */
interface SectionShape {
  /** Must equal this entry's key in SECTION; it's what messages carry. */
  readonly key: string;
  /** Semantic DOM id — the durable anchor. Not localized, unlike everything else here. */
  readonly id: string;
  /** Human-readable name, for logs and failure messages only. Never a selector. */
  readonly label: string;
  /** The rewards page hosting this section — the site splits them across `/` and `/earn`. */
  readonly url: string;
  /**
   * Matched against the toggle's `aria-label` / the section's `<h2>` — the
   * last-resort tier of section-toggle resolution (see resolveSectionToggle).
   *
   * These are English-only and so rank *below* the id-based tiers, which hold in
   * every locale. Do not delete them as redundant: if the site unmounts a
   * collapsed section's children, `section#id` isn't in the DOM at the one moment
   * we need it, and label matching is the only tier that can find the toggle.
   */
  readonly labelPatterns: readonly RegExp[];
}

/**
 * The sections we click cards in. Semantic section ids are the only durable
 * anchors on the site, and they scope card lookup to the right region — titles
 * are only unique *within* a section, so a document-wide match can land on a
 * quest, level-up, or nav anchor instead.
 *
 * Adding a section (`quests`, `levelup`) is one entry here — nothing else in the
 * expand/click path needs to know about it.
 */
export const SECTION = {
  dailySet: {
    key: 'dailySet',
    id: 'dailyset',
    label: 'Daily set',
    url: REWARDS_URL,
    labelPatterns: [/^daily set$/i, /^today's daily set$/i],
  },
  exploreOnBing: {
    key: 'exploreOnBing',
    id: 'exploreonbing',
    label: 'Explore on Bing',
    url: REWARDS_EARN_URL,
    labelPatterns: [/^explore on bing$/i],
  },
  moreActivities: {
    key: 'moreActivities',
    id: 'moreactivities',
    label: 'Keep earning',
    url: REWARDS_EARN_URL,
    labelPatterns: [/^keep earning$/i, /^more activities$/i],
  },
} as const satisfies Record<string, SectionShape>;

export type SectionKey = keyof typeof SECTION;
export type SectionDescriptor = (typeof SECTION)[SectionKey];

/** The section an activity's card lives in. Null for IGNORED, which is never clicked. */
export function sectionForActivityType(activityType: ActivityType): SectionDescriptor | null {
  switch (activityType) {
    case ACTIVITY_TYPE.DAILY_SET:
      return SECTION.dailySet;
    case ACTIVITY_TYPE.EXPLORE_ON_BING:
      return SECTION.exploreOnBing;
    case ACTIVITY_TYPE.MORE_ACTIVITIES:
      return SECTION.moreActivities;
    default:
      return null;
  }
}

/** Resolve a descriptor from the key carried in a message payload. */
export function sectionByKey(key: SectionKey): SectionDescriptor {
  return SECTION[key];
}

export interface ActivityState {
  allActivities: Activity[];
  loggedIn: boolean;
  rewardsTabId: number | null;
}

export interface Activity {
  id: string;
  title: string;
  description: string;
  activityType: ActivityType;
  cardState: CardState;
  points: number;
  /**
   * The card anchor's resolved absolute href, captured from the DOM at
   * extraction — the exact key locate/validate use to tie-break duplicate
   * titles (title-within-section is the primary key).
   */
  destinationUrl: string;
  searchQuery?: string | null;
  fallbackQuery?: string | null;
  requiresUserAction: boolean;
  userActionKind: UserActionKind | null;
  userActionTimeoutMs: number;
}

/** Raw card data sent from content script before classification. */
export interface RawCard {
  id: string;
  title: string;
  description: string;
  points: number;
  cardState: CardState;
  source: CardSource;
  /** The card anchor's resolved absolute href — see Activity.destinationUrl. */
  destinationUrl: string;
}
