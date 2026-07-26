import { Linking, Platform } from 'react-native';

// Relative rather than through the `@/` alias: the module lives outside src/, and a path
// that resolves in tsc but not in Metro is a bundling failure this project has hit before.
import { hasNativeUpi, listUpiApps as listNative, payViaUpi } from '../../../modules/upi';

/**
 * Which UPI apps we can hand a payment to.
 *
 * Two paths, and which one is available depends on the build:
 *
 * 1. **The native module** (`modules/upi/`) enumerates the installed apps with their real
 *    names and icons and targets one specific package. Present only in a build that includes
 *    it — adding a native module needs a full rebuild, not a Metro restart.
 *
 * 2. **`Linking`**, which always works. On Android `upi://pay` is a real system-level intent,
 *    so `openURL` opens the OS's own UPI chooser — genuinely good, just not our design. On iOS
 *    there is no `upi://` handler at all (the NPCI spec is Android-only), so each app's own
 *    scheme is probed with `canOpenURL`.
 *
 * Both degrade to the QR code, which is the only thing that works everywhere — including when
 * a bank app ignores the intent, and when someone else is doing the paying.
 *
 * Every iOS scheme here must also be in `LSApplicationQueriesSchemes` in app.config.ts, or
 * iOS answers "not installed" for all of them without saying why.
 */

export interface UpiApp {
  id: string;
  label: string;
  /** `data:image/png;base64,…` from the native module. Android only. */
  iconBase64?: string | null;
  /** Set only on the Linking path; the native module targets by id instead. */
  iosScheme?: string;
  /**
   * Path after the iOS scheme. Defaults to `pay`. Google Pay is the known exception — its
   * documented iOS form is `gpay://upi/pay`, and `gpay://pay` opens the app doing nothing.
   */
  iosPath?: string;
}

const IOS_FALLBACK_APPS: UpiApp[] = [
  { id: 'gpay', label: 'Google Pay', iosScheme: 'gpay', iosPath: 'upi/pay' },
  { id: 'phonepe', label: 'PhonePe', iosScheme: 'phonepe' },
  { id: 'paytm', label: 'Paytm', iosScheme: 'paytmmp' },
  { id: 'bhim', label: 'BHIM', iosScheme: 'bhim' },
];

export interface UpiCapability {
  apps: UpiApp[];
  /** True when the list came from the native module, so ids can be targeted directly. */
  native: boolean;
}

export async function discoverUpiApps(): Promise<UpiCapability> {
  if (hasNativeUpi) {
    const apps = await listNative();
    if (apps.length > 0) return { apps, native: true };
    // An empty list is ambiguous — no UPI apps, or a manifest missing its <queries> block —
    // so fall through to the path that does not need discovery to work at all.
  }

  if (Platform.OS !== 'ios') return { apps: [], native: false };

  const checks = await Promise.all(
    IOS_FALLBACK_APPS.map(async (app) => {
      try {
        return (await Linking.canOpenURL(`${app.iosScheme}://`)) ? app : null;
      } catch {
        // A scheme missing from LSApplicationQueriesSchemes throws rather than returning
        // false. Treat it as "not available" rather than failing the whole screen.
        return null;
      }
    }),
  );

  return { apps: checks.filter((a): a is UpiApp => a !== null), native: false };
}

/**
 * Hand the payment off.
 *
 * Returns false rather than throwing when nothing opens: "no UPI app answered" is an ordinary
 * outcome this screen has a fallback for, not an error worth a red toast.
 */
export async function openUpiPayment(
  uri: string,
  options: { app?: UpiApp; native?: boolean } = {},
): Promise<boolean> {
  const { app, native } = options;

  if (native && app) return payViaUpi(app.id, uri);

  /*
   * No app named on Android means the system chooser, which is the right default there.
   *
   * On iOS the scheme is swapped for the target app's own, because there is no `upi://`
   * handler — but the PATH is not always `pay`, and assuming it was produced a URL Google Pay
   * does not answer. Google documents the iOS form as `gpay://upi/pay?…`, so a blanket
   * `replace('upi://', 'gpay://')` yields `gpay://pay?…` and silently opens the app on its home
   * screen with nothing filled in. The path now comes from the app entry.
   * https://developers.google.com/pay/india/api/ios/in-app-payments
   *
   * The other three keep `pay`, which is what they are widely used with — but that is inherited
   * belief, not something documented by PhonePe, Paytm or NPCI, and none of it has run on a
   * real iOS device yet. The QR fallback is what actually carries iOS until it has.
   */
  const target =
    Platform.OS === 'ios' && app?.iosScheme
      ? uri.replace('upi://pay', `${app.iosScheme}://${app.iosPath ?? 'pay'}`)
      : uri;

  try {
    if (!(await Linking.canOpenURL(target))) return false;
    await Linking.openURL(target);
    return true;
  } catch {
    return false;
  }
}
