import * as WebBrowser from 'expo-web-browser';

import { color } from '@/design';

/**
 * Where Chukta lives on the web, and the two pages the stores require.
 *
 * ---------------------------------------------------------------- why this file exists
 *
 * The origin was written out in two places and the legal links in a third — and the third was
 * `https://example.com/terms`. That is the copy a user agrees to at sign-up, so the one link
 * that had to work was the one pointing at a placeholder domain.
 *
 * One constant now, env-overridable, so buying the real domain is a single change rather than a
 * hunt. `EXPO_PUBLIC_SITE_ORIGIN` is read at bundle time like every other `EXPO_PUBLIC_` value.
 *
 * The default is the GitHub Pages URL published from `legal/`. Both stores require Terms and
 * Privacy to be reachable **without the app installed**, which rules out anything served from
 * inside it.
 */
export const SITE_ORIGIN =
  process.env.EXPO_PUBLIC_SITE_ORIGIN ?? 'https://gaone1906.github.io/chukta';

export type LegalPage = 'terms' | 'privacy';

export const legalUrl = (page: LegalPage): string => `${SITE_ORIGIN}/${page}`;

/**
 * Open Terms or Privacy in an in-app browser.
 *
 * Not `Linking.openURL` — reading the terms should not throw the user out to Safari and lose
 * their place, and on the sign-in screen that place is a half-finished sign-up.
 *
 * Returns false rather than throwing so a caller can toast; there is nothing useful to do about
 * a browser that will not open except say so.
 */
export async function openLegal(page: LegalPage): Promise<boolean> {
  try {
    await WebBrowser.openBrowserAsync(legalUrl(page), {
      toolbarColor: color.bgBase,
      controlsColor: color.goldBright,
    });
    return true;
  } catch {
    return false;
  }
}
