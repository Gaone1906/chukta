import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@chukta/core';
import { AppState } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

import { env } from './env';

/**
 * Session storage.
 *
 * MMKV rather than AsyncStorage: it is synchronous, which matters here because Supabase reads
 * the persisted session during client construction. An async store means a frame or two where
 * the app believes nobody is signed in and bounces to the login screen before correcting
 * itself — a visible flash on every cold start.
 */
// react-native-mmkv v4: instances come from createMMKV(), and the delete method is `remove`.
const storage = createMMKV({ id: 'chukta-auth' });

const mmkvStorageAdapter = {
  getItem: (key: string) => storage.getString(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => {
    storage.remove(key);
  },
};

export const supabase: SupabaseClient<Database> = createClient<Database>(
  env.supabaseUrl,
  env.supabaseAnonKey,
  {
    auth: {
      storage: mmkvStorageAdapter,
      autoRefreshToken: true,
      persistSession: true,
      // React Native has no URL to parse a session out of; the native sign-in flows hand us
      // an id token directly.
      detectSessionInUrl: false,
    },
  },
);

/**
 * Refreshing on a timer while the app is backgrounded burns battery and can fire a burst of
 * requests on resume. Pause it instead and refresh once when the user comes back.
 */
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});

/** Clears the persisted session. Used by sign-out and by the account-deletion flow. */
export function clearAuthStorage(): void {
  storage.clearAll();
}
