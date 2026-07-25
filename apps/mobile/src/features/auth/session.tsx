import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  upi_vpa: string | null;
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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string | undefined) {
    if (!userId) {
      setProfile(null);
      return;
    }
    // The signup trigger creates this row, but the client may well win the race on a brand new
    // account — a missing profile is expected here, not an error.
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, upi_vpa')
      .eq('user_id', userId)
      .maybeSingle();

    setProfile(data ?? null);
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
