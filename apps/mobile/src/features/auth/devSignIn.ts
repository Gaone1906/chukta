import { supabase } from '@/lib/supabase';

/**
 * Dev-only sign-in against a local Supabase stack.
 *
 * Exists so the whole onboarding flow — the signup trigger, profile setup, the completion
 * seal, the routing between them — can be exercised without waiting on OAuth credentials, and
 * so a fresh account is one tap away when testing the first-run experience.
 *
 * Every call site is wrapped in `__DEV__`, so this cannot reach a release build. It also only
 * works where email signup needs no confirmation, which is the local stack's default and not
 * how the hosted project is configured.
 */
export async function devSignIn(email = 'dev@chukta.test', password = 'chukta-dev-password'): Promise<void> {
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (!signInError) return;

  // First run on a fresh database: create the account, which fires the signup trigger and
  // gets a profile created the same way a real sign-up would.
  const { error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) throw signUpError;

  const { error: retryError } = await supabase.auth.signInWithPassword({ email, password });
  if (retryError) throw retryError;
}

/** A throwaway address, so each tap starts a genuinely new account. */
export function randomDevEmail(): string {
  return `dev-${Math.random().toString(36).slice(2, 9)}@chukta.test`;
}
