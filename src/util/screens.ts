export interface OnboardingScreen {
  id:       string;  // unique, stable key stored in seenScreenIds
  title:    string;
  bodyFile: string;  // path relative to extension root, fetched at runtime
}

export const SCREENS: OnboardingScreen[] = [
  { id: 'tos-v1',          title: 'Terms of Use',        bodyFile: 'ui/screens/tos-v1.html' },
  { id: 'bing-warning-v1', title: 'Bing Account Risk',   bodyFile: 'ui/screens/bing-warning-v1.html' },
{ id: 'changelog-1.6.0', title: "What's New in 1.6",   bodyFile: 'ui/screens/changelog-1.6.0.html' },
];
