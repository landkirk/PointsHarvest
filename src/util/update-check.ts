const LATEST_VERSION_URL = 'https://r2.pointsharvest.com/latest-version.txt';
const FETCH_TIMEOUT_MS = 1000;

export interface UpdateCheckResult {
  hasUpdate: boolean;
  latestVersion: string; // e.g. "1.7.2"
  installedVersion: string; // e.g. "1.7.1"
}

/** Compare two semver strings (e.g. "1.7.2" vs "1.7.1").
 *  Returns >0 if a > b, 0 if equal, <0 if a < b. */
function compareSemver(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Fetch the latest published version from R2 and compare against the installed
 *  extension version. Returns null if the check cannot be completed (network
 *  error, timeout, unexpected response). */
export async function checkForUpdate(): Promise<UpdateCheckResult | null> {
  const installedVersion = chrome.runtime.getManifest().version;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(LATEST_VERSION_URL, { signal: controller.signal });
    if (!res.ok) return null;

    const text = (await res.text()).trim();
    const latestVersion = text.replace(/^v/, '');

    if (!/^\d+(\.\d+)*$/.test(latestVersion)) return null;

    return {
      hasUpdate: compareSemver(latestVersion, installedVersion) > 0,
      latestVersion,
      installedVersion,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
