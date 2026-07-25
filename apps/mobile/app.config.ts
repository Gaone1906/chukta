import type { ExpoConfig } from 'expo/config';

// The store-facing display name is deliberately a variable: "Hisaab" already exists on the
// stores, so the final name is decided before submission (plan/PROGRESS.md, open question #1).
// The bundle identifier is NOT flexible — it is painful to change after first submission.
const DISPLAY_NAME = process.env.APP_DISPLAY_NAME ?? 'Hisaab';

// Product-named and namespace-neutral. Never shown to users, so it can stay `hisaab` even if
// the store display name has to change. Owning hisaab.com is not required for this.
const BUNDLE_ID = 'com.hisaab.app';

const config: ExpoConfig = {
  name: DISPLAY_NAME,
  slug: 'hisaab',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'hisaab',

  // Dark mode only — a deliberate, permanent decision, not a placeholder. See docs/design-doc.md.
  userInterfaceStyle: 'dark',
  backgroundColor: '#0A0405',

  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    // UPI apps must be declared here or canOpenURL() always returns false.
    // Populated by the UPI config plugin in Phase 6.
    infoPlist: {
      LSApplicationQueriesSchemes: ['upi', 'gpay', 'tez', 'phonepe', 'paytmmp', 'bhim', 'venmo'],

      // Google's iOS SDK redirects back into the app through the reversed client id. Without
      // this URL scheme the sheet opens and then has nowhere to return to.
      CFBundleURLTypes: [
        {
          CFBundleURLSchemes: [
            'com.googleusercontent.apps.36711202265-bp0smtoeibrkofpsvf9gfnv1u1cs9am5',
          ],
        },
      ],
    },
  },

  android: {
    package: BUNDLE_ID,
    predictiveBackGestureEnabled: false,
  },

  // withDebugKeystore replaces Expo's shared debug keystore with ours, so the Android
  // SHA-1 is unique to this project and can be registered with Google OAuth.
  plugins: [
    'expo-router',
    'expo-font',
    './plugins/withDebugKeystore',
    // Android 11+ package visibility. Without it, UPI app discovery silently finds nothing.
    './plugins/withUpiQueries',
  ],

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
