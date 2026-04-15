export interface OnboardingScreen {
  id: string; // unique, stable key stored in seenScreenIds
  title: string;
  bodyFile: string; // path relative to extension root, fetched at runtime
}

export const SCREENS: OnboardingScreen[] = [
  { id: 'tos-v1', title: 'Terms of Use', bodyFile: 'ui/screens/tos-v1.html' },
  {
    id: 'bing-warning-v1',
    title: 'Bing Account Risk',
    bodyFile: 'ui/screens/bing-warning-v1.html',
  },
  {
    id: 'changelog-2.1.0',
    title: "What's New in 2.1.0",
    bodyFile: 'ui/screens/changelog-2.1.0.html',
  },
];

/** Shown when a newer version is available. Not persisted to seenScreenIds,
 *  so it re-appears on every popup open until the user updates. */
export const UPDATE_SCREEN: OnboardingScreen = {
  id: 'update-available',
  title: 'Update Available',
  bodyFile: 'ui/screens/update-available.html',
};
