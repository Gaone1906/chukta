import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * The typed surface over the local `Upi` native module.
 *
 * `requireOptionalNativeModule` rather than `requireNativeModule`: a native module only exists
 * once the dev client has been rebuilt, and adding one and forgetting the rebuild is a trap
 * this project has already fallen into (expo-clipboard, same session). Importing it must not
 * take the whole screen down — the settle-up flow has a `Linking` path and a QR that work
 * without any of this.
 */

export interface NativeUpiApp {
  /** Android package name, or the scheme id on iOS. */
  id: string;
  label: string;
  /** `data:image/png;base64,…`. Android only — iOS exposes no API for another app's icon. */
  iconBase64?: string | null;
}

interface UpiNativeModule {
  isAvailable(): boolean;
  listUpiApps(): Promise<NativeUpiApp[]>;
  payViaUpi(appId: string, uri: string): Promise<boolean>;
}

const native = requireOptionalNativeModule<UpiNativeModule>('Upi');

/** True when this build actually contains the module. False in Expo Go or before a rebuild. */
export const hasNativeUpi = native != null;

/**
 * Installed UPI apps, with their real names and icons.
 *
 * Returns an empty list rather than throwing when the module is missing, when the manifest is
 * missing its `<queries>` block, or when the user genuinely has no UPI app — all three look
 * the same from here, and all three lead to the same fallback.
 */
export async function listUpiApps(): Promise<NativeUpiApp[]> {
  if (!native) return [];
  try {
    return await native.listUpiApps();
  } catch {
    return [];
  }
}

/** Send a payment to one specific app. False means "it didn't open", not "it failed". */
export async function payViaUpi(appId: string, uri: string): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.payViaUpi(appId, uri);
  } catch {
    return false;
  }
}
