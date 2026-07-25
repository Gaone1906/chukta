import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createMMKV } from 'react-native-mmkv';

import { supabase } from '@/lib/supabase';

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  upi_vpa: string | null;
}

/**
 * The profile, cached beside the session.
 *
 * Same MMKV instance as the session on purpose, so `clearAuthStorage()` takes both — a cached
 * profile outliving a sign-out would be somebody else's name on the next person's screen.
 *
 * Why this exists at all: the session is persisted but the profile was fetched fresh on every
 * launch, and a *failed* fetch was indistinguishable from "this person has no profile". So a
 * cold start with no network signed you in, found nothing, decided onboarding was unfinished
 * and dropped you on "Tell us who you are" — with your name gone from the field. Found by
 * launching the app with the server pulled out from under it.
 */
const profileStore = createMMKV({ id: 'hisaab-auth' });
const PROFILE_KEY = 'cached-profile';

function readCachedProfile(): Profile | null {
  const raw = profileStore.getString(PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: Profile | null): void {
  if (profile) profileStore.set(PROFILE_KEY, JSON.stringify(profile));
  else profileStore.remove(PROFILE_KEY);
}

interface SessionState {
  /** Null while the persisted session is still being read. */
  session: Session | null;
  profile: Profile | null;
  /** True until we know whether anyone is signed in — routing must wait for this. */
  loading: boolean;
  /** A signed-in user whose profile has no name yet still has onboarding to finish. */
  needsProfileSetup: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // Seeded from disk, so a launch with no network starts from what we last knew rather than
  // from nothing.
  const [profile, setProfile] = useState<Profile | null>(readCachedProfile);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string | undefined) {
    if (!userId) {
      setProfile(null);
      writeCachedProfile(null);
      return;
    }

    // The signup trigger creates this row, but the client may well win the race on a brand new
    // account — a missing profile is expected here, not an error.
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, upi_vpa')
      .eq('user_id', userId)
      .maybeSingle();

    /*
     * A failed request is not an answer.
     *
     * This distinction is the whole fix. `data` is null both when the server says "no such
     * profile" and when we never reached the server — and treating the second as the first
     * makes `needsProfileSetup` true, which sends a signed-in user with a perfectly good
     * account back to onboarding the moment they open the app on a train.
     */
    if (error) return;

    setProfile(data ?? null);
    writeCachedProfile(data ?? null);
  }

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      if (!cancelled) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void loadProfile(next?.user.id);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      session,
      profile,
      loading,
      // 'Someone' is the placeholder the signup trigger writes when no name came from the
      // provider — Google always sends one, Apple only on the very first authorisation.
      needsProfileSetup:
        session != null && (profile == null || profile.display_name.trim() === 'Someone'),
      refreshProfile: () => loadProfile(session?.user.id),
      signOut: async () => {
        await supabase.auth.signOut();
        setProfile(null);
      },
    }),
    [session, profile, loading],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
