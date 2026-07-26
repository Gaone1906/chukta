import { Platform } from 'react-native';

import { normalisePhone } from '@chukta/core';

/**
 * Pick exactly one contact, and read exactly that one contact.
 *
 * ---------------------------------------------------------------- the shape of the promise
 *
 * This reverses a decision that was made deliberately and documented in three places, so it is
 * worth being precise about what changed and what did not.
 *
 * **What was rejected, and still is:** reading the address book. `getAll()` exists in this
 * package and is never called here. Nothing is enumerated, nothing is hashed and uploaded to
 * ask the server "which of these numbers are users", and Chukta never learns who is in your
 * contacts. That upload is the thing that makes contact-matching a privacy problem, and it is
 * the thing we are still not doing.
 *
 * **What is allowed now:** the system picker. `Contact.presentPicker()` is presented BY THE OS,
 * the app does not see the list, and the promise resolves with the single contact the user
 * chose. That is the same disclosure as typing the name and number in by hand — which the app
 * already accepts — minus the typing and the typos.
 *
 * On iOS 18+ this needs no permission grant at all, because the picker is out-of-process; the
 * usage string in app.config.ts covers older versions and Android.
 *
 * ---------------------------------------------------------------- and what it can resolve to
 *
 * **A picked number can only ever match a placeholder, never a real Chukta account.** Nothing
 * writes a `kind='phone'` contact point for a signed-up user — `set_my_phone` was the only
 * thing that would have, and phone was dropped from v1. So this is not "find your friends who
 * are already on Chukta", and the copy around it must not suggest it is.
 *
 * It is still worth having: two friends who each add the same person by phone converge on ONE
 * placeholder instead of two, which is the duplicate-identity problem `normalisePhone` exists
 * to solve. Email remains the only identifier that resolves to a real account.
 */
export interface PickedContact {
  name: string;
  /** E.164, or null when the contact had no number we could make sense of. */
  phone: string | null;
  /** True when the contact had a number but it did not normalise — worth telling the user. */
  phoneRejected: boolean;
}

/**
 * Required lazily for the same reason `rate.ts` does it: a top-level import of a native module
 * throws at module scope on a build without it compiled in, and expo-router evaluates every
 * route file to construct its route tree — so one missing module blanks the whole app group
 * rather than just this feature. See features/tip/rate.ts.
 */
function contacts(): typeof import('expo-contacts') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-contacts') as typeof import('expo-contacts');
  } catch {
    return null;
  }
}

/** Whether the picker can be offered at all on this build. */
export function contactPickerAvailable(): boolean {
  return contacts() !== null;
}

/**
 * Thrown when the OS refused the contacts permission.
 *
 * A distinct type rather than a message, because refusal is the one outcome the caller must
 * say something about: the user tapped a button and the picker did not appear, so silence
 * reads as the app being broken. Cancellation and an absent module stay `null` — nothing
 * happened, and nothing needs saying.
 */
export class ContactsPermissionDenied extends Error {
  constructor() {
    super('contacts-permission-denied');
  }
}

/**
 * Present the picker. Resolves null when the user cancelled or the module is absent — both are
 * ordinary outcomes and neither is an error worth surfacing.
 *
 * ---------------------------------------------------------------- the Android permission
 *
 * Declaring `READ_CONTACTS` in the manifest is necessary and NOT sufficient: Android has
 * required a runtime grant for it since API 23, and without one `presentPicker()` rejects with
 *
 *     Missing android.permission.READ_CONTACTS permission
 *
 * which the first Android build put on screen verbatim, inside the sheet, as though it were
 * copy. Found by running the APK rather than by reading this file — nothing here looked wrong.
 *
 * Requested on **Android only**, deliberately. On iOS the picker is drawn out of process and
 * needs no grant at all, so asking would put a permission dialog in front of the user to buy
 * exactly nothing — and a contacts prompt an app does not need is the kind of thing App Review
 * asks about.
 */
export async function pickContact(): Promise<PickedContact | null> {
  const mod = contacts();
  if (mod === null) return null;

  if (Platform.OS === 'android') {
    const { granted } = await mod.requestPermissionsAsync();
    if (!granted) throw new ContactsPermissionDenied();
  }

  const contact = await mod.Contact.presentPicker();
  if (contact === null) return null;

  const details = await contact.getDetails();
  const phones = await contact.getPhones();

  const name = [details.givenName, details.familyName]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .trim();

  // Take the first number that normalises rather than the first number outright: a contact
  // whose landline is listed above their mobile should still resolve, and a number we cannot
  // parse is worse than none because it would create an identity nothing else can match.
  let phone: string | null = null;
  for (const entry of phones) {
    const candidate = normalisePhone(String(entry.number ?? ''));
    if (candidate !== null) {
      phone = candidate;
      break;
    }
  }

  return {
    // `getDetails()` with no field list does not include a display name, so the given/family
    // pair above is the only name available. A contact with neither is left blank rather than
    // guessed at — the user is looking at the field and can type it.
    name,
    phone,
    phoneRejected: phone === null && phones.length > 0,
  };
}
