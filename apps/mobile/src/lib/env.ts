/**
 * Typed access to the EXPO_PUBLIC_ variables, read once at module load.
 *
 * These are inlined into the bundle at build time, so every value here is public. That is fine
 * for what's here — the Supabase anon key grants nothing on its own, because every table sits
 * behind row level security. The service_role key must never appear in this file or any other
 * part of the app.
 *
 * See docs/setup-services.md for where the values come from.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy apps/mobile/.env.example to .env and fill it in — see docs/setup-services.md`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),

  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',

  /**
   * Phone/OTP is fully built but hidden for v1: Indian SMS needs TRAI DLT registration of the
   * sender ID and templates, plus a paid provider. Flip to '1' once that clears.
   */
  phoneAuthEnabled: process.env.EXPO_PUBLIC_ENABLE_PHONE_AUTH === '1',
} as const;

/** True when Google sign-in is actually configured, so the button can be hidden rather than failing. */
export const googleConfigured = env.googleWebClientId.length > 0;
