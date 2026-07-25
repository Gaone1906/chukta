import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';

import { env, googleConfigured } from '@/lib/env';
import { supabase } from '@/lib/supabase';

/**
 * Native sign-in, not web OAuth redirects.
 *
 * Both providers hand back an ID token that goes straight to `signInWithIdToken`. The web
 * redirect flow works too, but it bounces through a browser, looks wrong on a phone, and
 * behaves badly in a dev client.
 *
 * Neither works in Expo Go — they need a development build.
 */

export class AuthCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

let googleConfiguredOnce = false;

function configureGoogle() {
  if (googleConfiguredOnce) return;
  GoogleSignin.configure({
    // Supabase validates the token against the WEB client id even on native, because that is
    // what it has registered. The iOS id is what the native sheet itself uses.
    webClientId: env.googleWebClientId,
    iosClientId: env.googleIosClientId || undefined,
  });
  googleConfiguredOnce = true;
}

export async function signInWithGoogle(): Promise<void> {
  if (!googleConfigured) {
    throw new Error('Google sign-in is not configured yet — see docs/setup-services.md');
  }

  configureGoogle();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const result = await GoogleSignin.signIn();
  if (result.type === 'cancelled') throw new AuthCancelled();

  const idToken = result.data?.idToken;
  if (!idToken) throw new Error('Google returned no ID token');

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw error;
}

export const appleAuthAvailable = Platform.OS === 'ios';

export async function signInWithApple(): Promise<void> {
  if (!appleAuthAvailable) throw new Error('Sign in with Apple is iOS only');

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new AuthCancelled();
    throw error;
  }

  if (!credential.identityToken) throw new Error('Apple returned no identity token');

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;

  /*
   * APPLE GIVES THE NAME EXACTLY ONCE.
   *
   * `fullName` is populated only on the very first authorisation for this app. Every later
   * sign-in returns null, and there is no API to ask again — the only way to get another
   * first authorisation is for the user to revoke the app in iOS Settings. So it is written
   * through immediately rather than carried through the onboarding flow, where a crash or a
   * backgrounded app would lose it for good.
   */
  const given = credential.fullName?.givenName?.trim();
  const family = credential.fullName?.familyName?.trim();
  const fullName = [given, family].filter(Boolean).join(' ');

  if (fullName && data.user) {
    await supabase
      .from('profiles')
      .update({ display_name: fullName })
      .eq('user_id', data.user.id)
      // Don't clobber a name the user has already chosen, or one a friend gave their
      // placeholder before they signed up.
      .eq('display_name', 'Someone');
  }
}
