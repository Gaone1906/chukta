import { supabase } from '@/lib/supabase';

/**
 * Dev-only sign-in against a local Supabase stack.
 *
 * Exists so the whole onboarding flow — the signup trigger, profile setup, the completion
 * seal, the routing between them — can be exercised without waiting on OAuth credentials, and
 * so a fresh account is one tap away when testing the first-run experience.
 *
 * ---------------------------------------------------------------- what `__DEV__` does and does not do
 *
 * Every call site is wrapped in `__DEV__`, so this code cannot RUN in a release build. It used
 * to say the stronger thing — that it "cannot reach a release build" — and that was wrong.
 * Checked against the first real APK, by unpacking it and running `strings` over the Hermes
 * bytecode: `dev@chukta.test` and the password below are both in the shipped bundle.
 *
 * The reason is that `sign-in.tsx` imports this module STATICALLY. Metro builds its dependency
 * graph from imports before the minifier folds `__DEV__` away, so the module ships even though
 * every path into it is dead. A guard around the call site is not a guard around the bundle.
 *
 * Harmless here, and worth saying why rather than just asserting it: the path is unreachable,
 * the account does not exist on the hosted project, and anyone could create it anyway with the
 * publishable key, which is public by design. So these two strings grant nothing.
 *
 * **The rule this is here to record: never put a real secret behind a `__DEV__` guard and
 * assume it is stripped.** It is not. It is inert, which is a different thing. Anything that
 * must not ship has to be absent from the module graph — an env var, or a lazily required
 * module that nothing imports at the top level.
 *
 * It also only works where email signup needs no confirmation, which is the local stack's
 * default and not how the hosted project is configured.
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
