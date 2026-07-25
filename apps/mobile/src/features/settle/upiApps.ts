import { Linking, Platform } from 'react-native';

/**
 * Which UPI apps we can hand a payment to, without native code.
 *
 * The honest platform split, from the NPCI spec:
 *
 * **Android** — `upi://pay` is a real system-level intent that every UPI app registers for, so
 * `Linking.openURL` opens Android's own UPI chooser. Targeting one specific app instead needs
 * `queryIntentActivities` and per-package `startActivity`, which is the local native module in
 * `modules/upi/` — this file is the path that works with none of that.
 *
 * **iOS** — there is no `upi://` handler at all; the spec is Android-only. Each app registers
 * its own scheme and their support for prefilled parameters is undocumented and historically
 * flaky. `canOpenURL` at least tells us which are installed, and every one of them is offered
 * alongside the QR fallback rather than instead of it.
 *
 * Every scheme here must also appear in `LSApplicationQueriesSchemes` in app.config.ts, or
 * iOS answers "not installed" for all of them without saying why.
 */

export interface UpiApp {
  id: string;
  label: string;
  /** The scheme to try on iOS. Android goes through the system chooser instead. */
  iosScheme: string;
}

export const IOS_UPI_APPS: UpiApp[] = [
  { id: 'gpay', label: 'Google Pay', iosScheme: 'gpay' },
  { id: 'phonepe', label: 'PhonePe', iosScheme: 'phonepe' },
  { id: 'paytm', label: 'Paytm', iosScheme: 'paytmmp' },
  { id: 'bhim', label: 'BHIM', iosScheme: 'bhim' },
];

/** Which of the known apps are actually installed. Android returns [] — it uses the chooser. */
export async function installedUpiApps(): Promise<UpiApp[]> {
  if (Platform.OS !== 'ios') return [];

  const checks = await Promise.all(
    IOS_UPI_APPS.map(async (app) => {
      try {
        return (await Linking.canOpenURL(`${app.iosScheme}://`)) ? app : null;
      } catch {
        // A scheme missing from LSApplicationQueriesSchemes throws rather than returning
        // false. Treat it as "not available" rather than failing the whole screen.
        return null;
      }
    }),
  );
  return checks.filter((a): a is UpiApp => a !== null);
}

/**
 * Hand the payment off.
 *
 * Returns false rather than throwing when nothing can open the URI, because "no UPI app
 * responded" is an ordinary outcome the screen has a fallback for — the QR code — not an
 * error worth a red toast.
 */
export async function openUpiPayment(uri: string, app?: UpiApp): Promise<boolean> {
  const target = Platform.OS === 'ios' && app ? uri.replace('upi://', `${app.iosScheme}://`) : uri;

  try {
    if (!(await Linking.canOpenURL(target))) return false;
    await Linking.openURL(target);
    return true;
  } catch {
    return false;
  }
}
