export interface Activity {
  title:       string;
  description: string;
  href:        string;
}

export interface MappedActivity extends Activity {
  query:     string | null;
  unmatched: boolean;
}
