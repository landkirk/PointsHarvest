export interface Activity {
  title:       string;
  description: string;
  href:        string;
}

export interface MappedActivity extends Activity {
  query:     string | null;
  unmatched: boolean;
}

export type CardState = 'actionable' | 'completed' | 'locked' | 'unknown' | 'not-found';

export const CARD_STATE: Record<string, CardState> = {
  ACTIONABLE: 'actionable',
  COMPLETED:  'completed',
  LOCKED:     'locked',
  UNKNOWN:    'unknown',
  NOT_FOUND:  'not-found',
};
