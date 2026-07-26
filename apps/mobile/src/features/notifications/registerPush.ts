import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * Register this device for push, and tell the server where to reach it.
 *
 * ---------------------------------------------------------------- what gets stored, and why
 *
 * One row in `public.device_tokens` per (profile, device), upserted on that pair — so signing
 * in on a phone and a tablet gives two rows and buzzes both, while opening the app twice on one
 * phone gives one. The unique index is on `(profile_id, device_id)`, not on the token, because
 * **the Expo token is not stable**: it can rotate on reinstall, on OS upgrade, or when
 * credentials change. Keying on the token would accumulate a dead row per rotation and keep
 * pushing to every one of them.
 *
 * `timezone` is written here because this is the only place the app learns it, and the server's
 * quiet-hours logic has nothing else to work from (see `internal.next_sendable_at`).
 *
 * ---------------------------------------------------------------- when NOT to ask
 *
 * The permission prompt is asked once per install and cannot be re-asked once denied, so it is
 * deliberately not fired at first launch. It is called after sign-in, when the app has already
 * shown the user something worth being notified about — a cold prompt on a screen the user has
 * not yet understood is the reliable way to get a permanent "no".
 *
 * ---------------------------------------------------------------- required lazily
 *
 * `require`, not a top-level import, for the reason documented in `features/tip/rate.ts`: a
 * missing native module throws at module scope, expo-router evaluates every route file to build
 * its tree, and one absent module therefore blanks the ENTIRE app group. A device that cannot
 * do push should lose push, not the app.
 */
function notifications(): typeof import('expo-notifications') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as typeof import('expo-notifications');
  } catch {
    return null;
  }
}

function device(): typeof import('expo-device') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-device') as typeof import('expo-device');
  } catch {
    return null;
  }
}

export type PushOutcome =
  | 'registered'
  | 'denied'
  | 'unsupported'   // simulator, or a build without the module
  | 'error';

/**
 * A stable id for this installation.
 *
 * `installationId` survives app restarts but not a reinstall, which is exactly the granularity
 * wanted: a reinstall genuinely is a new device as far as push is concerned, and the old row's
 * token will be retired by the receipt sweep when Expo reports `DeviceNotRegistered`.
 */
function deviceId(): string {
  return (
    Constants.sessionId ??
    `${Platform.OS}-${Constants.expoConfig?.slug ?? 'chukta'}`
  );
}

export async function registerForPush(profileId: string): Promise<PushOutcome> {
  /*
   * The device check comes FIRST, and the order is the whole point.
   *
   * A simulator cannot receive APNs at all. Asking anyway produces a permission grant that can
   * never deliver anything, which makes local testing read as working when it is not — that is
   * why the check exists. It used to run one line too late, after `notifications()` had already
   * `require`d expo-notifications.
   *
   * That require is not free on a simulator: loading the module makes expo-notifications read
   * its persisted registration out of the iOS keychain, which a simulator has no entitlement
   * for, and it logs the failure with `console.error` rather than throwing. LogBox turns any
   * `console.error` into a red panel, so every dev launch showed
   * `ERR_NOTIFICATIONS_KEYCHAIN_ACCESS` — alarming, harmless, and impossible to catch here
   * because nothing is thrown to us.
   *
   * Checking the device first means a simulator never loads the module, so the keychain is
   * never touched and there is nothing to log. `expo-device` reads a static property and does
   * not touch the keychain itself.
   */
  const Device = device();
  if (Device?.isDevice === false) return 'unsupported';

  const Notifications = notifications();
  if (Notifications === null) return 'unsupported';

  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;

    if (status !== 'granted') {
      // Only ask when we have not been answered before. iOS ignores a second ask anyway, and
      // asking Android repeatedly is the behaviour that trains people to hit Deny.
      if (!existing.canAskAgain) return 'denied';
      status = (await Notifications.requestPermissionsAsync()).status;
    }

    if (status !== 'granted') return 'denied';

    /*
     * The project id is required for a token that actually routes.
     *
     * Without it `getExpoPushTokenAsync` either throws or hands back a token tied to nothing,
     * and the failure only shows up as pushes silently never arriving — so it is checked here
     * rather than discovered in production.
     */
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return 'unsupported';

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

    const { error } = await supabase.from('device_tokens').upsert(
      {
        profile_id: profileId,
        expo_push_token: token,
        platform: Platform.OS,
        device_id: deviceId(),
        app_version: Constants.expoConfig?.version ?? null,
        // The server has no other source for this, and quiet hours are meaningless without it.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        last_seen_at: new Date().toISOString(),
        // A device that re-registers was clearly not uninstalled after all.
        disabled_at: null,
        disabled_reason: null,
      },
      { onConflict: 'profile_id,device_id' },
    );

    if (error) return 'error';
    return 'registered';
  } catch {
    // Push is never worth breaking a session over. The user simply does not get notifications
    // this run, and the next foreground tries again.
    return 'error';
  }
}
