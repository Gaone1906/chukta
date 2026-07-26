import type { ExpoConfig } from 'expo/config';

/*
 * "Chukta" — settled, paid off. What the seal has said all along: SQUARED · SETTLED.
 *
 * The name was forced rather than chosen. "Hisaab" is contested by at least eight shipping
 * apps, two of which are this same product with this same pitch — "Hisaab: Split Group
 * Expenses" on Play and "Hisaab: Split Bills & UPI" on the App Store. Being the ninth would
 * have meant no search discovery at all, plus a real chance of an Apple rejection for a
 * confusingly similar name. "Barabar" was checked and is also taken.
 *
 * Still a variable, because a store can refuse a name at submission and this should not need
 * a code change to answer that.
 */
const DISPLAY_NAME = process.env.APP_DISPLAY_NAME ?? 'Chukta';

// Never shown to users. Changed alongside the rename because a bundle id CANNOT change once a
// store listing exists — so it was now or never, and a package called `com.hisaab.app` under an
// app called Chukta would have been permanent misdirection for whoever reads this next.
const BUNDLE_ID = 'com.chukta.app';

const config: ExpoConfig = {
  name: DISPLAY_NAME,
  slug: 'chukta',

  /*
   * Which Expo account owns the EAS project.
   *
   * Required rather than optional here: this login has access to two accounts — `pranavyarasi`
   * and the `pranavyarasis-team` organisation Expo creates automatically at signup — and EAS
   * refuses to guess between them. The personal one, to match the personal Play account.
   *
   * Moving a project between accounts later is a support request, not a config change.
   */
  owner: 'pranavyarasi',

  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'chukta',

  /*
   * The launcher icon. Until now there was NO icon key at all, which does not fail a build —
   * it silently ships Expo's default, and that is a store rejection on both platforms.
   *
   * Option **1A "Pressed seal"** from the design doc's five directions: a gold ring and a single
   * Rozha One C on the oxblood radial. Sources and the exact geometry are in
   * `assets/icon/README.md`.
   *
   * Which of the doc's two size variants became the master was **measured, not chosen**. Its
   * 180px cell uses a 3.4 stroke with a second ring; its 60px cell drops the inner ring and
   * thickens the stroke to 5. Downscaled to 60px, the large cell's ring holds luminance 34.5
   * against the small cell's 49 — a thin stroke averages into a dark background, and the two
   * rings collapse onto each other. The small geometry won; the ink filter was kept because
   * texture degrades gracefully where a second ring does not.
   *
   * FLATTENED onto the oxblood and carrying no alpha channel, which is not cosmetic: the App
   * Store rejects an icon with transparency outright. Square and un-rounded too, because iOS
   * applies its own mask and rounding a source that is about to be rounded again produces a
   * visibly clipped corner.
   */
  icon: './assets/icon/icon.png',

  // Dark mode only — a deliberate, permanent decision, not a placeholder. See docs/design-doc.md.
  userInterfaceStyle: 'dark',
  backgroundColor: '#0A0405',

  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,

    /*
     * Sign in with Apple, declared HERE rather than only in the generated entitlements file.
     *
     * `ios/` is gitignored and regenerated, and the entitlement had only ever existed in the
     * generated `.entitlements` — so the next `expo prebuild --clean` would have silently
     * dropped it and broken Apple sign-in with no config change anywhere to explain why. This
     * had to land before the rename's prebuild, which is exactly such a clean.
     */
    usesAppleSignIn: true,
    // UPI apps must be declared here or canOpenURL() always returns false.
    // Populated by the UPI config plugin in Phase 6.
    infoPlist: {
      LSApplicationQueriesSchemes: ['upi', 'gpay', 'tez', 'phonepe', 'paytmmp', 'bhim', 'venmo'],

      /*
       * Google's iOS SDK redirects back into the app through the reversed client id. Without
       * this URL scheme the sheet opens and then has nowhere to return to.
       *
       * ⚠️ **STALE UNTIL A NEW iOS OAUTH CLIENT EXISTS.** A Google iOS client is bound to the
       * bundle id, and the bundle id just changed to `com.chukta.app`. The id below was issued
       * for the OLD bundle id, so iOS Google sign-in will fail until a new client is
       * created in Google Cloud for the new bundle id and BOTH this scheme and
       * `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` are updated to match it. The new client id must
       * also be added to Supabase Auth's comma-separated audience list, or the token is
       * rejected with `Unacceptable audience in id_token`.
       */
      CFBundleURLTypes: [
        {
          CFBundleURLSchemes: [
            'com.googleusercontent.apps.36711202265-bp0smtoeibrkofpsvf9gfnv1u1cs9am5',
          ],
        },
      ],

      /*
       * Receipts. Both strings are needed and they are NOT interchangeable: iOS shows the
       * camera one for taking a photo and the library one for choosing an existing file, and
       * shipping without whichever the app actually calls is an immediate review rejection.
       */
      NSCameraUsageDescription:
        'Chukta uses the camera only to photograph a receipt you attach to an expense.',
      NSPhotoLibraryUsageDescription:
        'Chukta reads only the photo you pick, to attach it to an expense as a receipt.',

      /*
       * Shown when adding someone from the contact picker.
       *
       * Worded to say what actually happens, because it is unusually narrow and the default
       * assumption about a contacts prompt is the opposite: we read the ONE contact you pick,
       * in a picker the OS draws, and the address book is never enumerated or uploaded. On
       * iOS 18+ the picker is out-of-process and this is never even shown.
       *
       * Narrow is not the same as nothing, and the store forms must not be filled in as though
       * it were: the picked name and number ARE sent to the server and stored. Contacts is
       * declared as **collected** on both — see plan/phase-11-store-release.md §4.
       */
      NSContactsUsageDescription:
        'Chukta only reads the single contact you choose, to fill in their name and number. Your address book is never uploaded.',
    },

    /*
     * ---------------------------------------------------------------- the iOS privacy manifest
     *
     * Declared HERE rather than as a hand-written `PrivacyInfo.xcprivacy`, for the same reason
     * `usesAppleSignIn` is: `ios/` is gitignored and regenerated, so a file that exists only in
     * there is one `prebuild --clean` away from vanishing with no config change to blame. Expo
     * generates the real manifest from this.
     *
     * **Everything below is `Linked: true`.** Every row in this database hangs off
     * `profiles.id`, and the account is identified at sign-in — there is no anonymous mode to
     * claim otherwise. Tracking is `false` throughout and `NSPrivacyTrackingDomains` is empty:
     * no ads, no attribution, no third party receives any of this. Sentry is the only external
     * recipient and it gets a profile id, never a name or an email.
     *
     * The judgement call worth recording is **Contacts**. What the app does is unusually narrow
     * — the OS draws the picker, `getAll()` is never called, no address book is enumerated or
     * uploaded — and that makes "accessed, not collected" tempting. It is wrong: the chosen
     * contact's name and E.164 number are sent to the server and stored as a placeholder
     * profile plus a contact point. Narrowness reduces volume, not retention. Under-declaring
     * here is the kind of thing that pulls an app after it ships.
     *
     * Balances and expense amounts are `OtherFinancialInfo` — this app's whole subject is who
     * owes whom, which is debt, and that sits squarely in Apple's financial category. The UPI
     * VPA goes there too: it is a payment handle rather than a card or account number, so
     * `PaymentInfo` would overstate it and omitting it entirely would understate it.
     */
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],

      NSPrivacyCollectedDataTypes: [
        // Identity.
        ...[
          'NSPrivacyCollectedDataTypeName',
          'NSPrivacyCollectedDataTypeEmailAddress',
          'NSPrivacyCollectedDataTypePhoneNumber',
          'NSPrivacyCollectedDataTypeUserID',
          // The contact picker. See the note above — this one is collected, not merely accessed.
          'NSPrivacyCollectedDataTypeContacts',
          // Receipt photographs.
          'NSPrivacyCollectedDataTypePhotosorVideos',
          // Expense descriptions, group names, comments.
          'NSPrivacyCollectedDataTypeOtherUserContent',
          // Amounts, balances, and the UPI VPA.
          'NSPrivacyCollectedDataTypeOtherFinancialInfo',
          // The Expo push token.
          'NSPrivacyCollectedDataTypeDeviceID',
        ].map((type) => ({
          NSPrivacyCollectedDataType: type,
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        })),

        /*
         * Sentry. Declared even though `lib/monitoring.ts` scrubs hard — console breadcrumbs
         * dropped, request and response bodies stripped, navigation reduced to from/to — because
         * a stack trace is still diagnostic data leaving the device, and it is tagged with the
         * profile id so it is linked.
         */
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCrashData',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
      ],

      /*
       * Required-reason APIs.
       *
       * These four are what a React Native app touches through its dependencies — MMKV and the
       * query persister hit UserDefaults, SQLite and the file cache stamp and read file times,
       * and Reanimated reads boot time for its clock. Over-declaring here is harmless;
       * UNDER-declaring produces an ITMS-91053 rejection email after upload, which costs a
       * build cycle to discover.
       *
       * Codes are Apple's, and each means "this app, for its own operation": CA92.1 reads back
       * only what this app wrote, C617.1 covers timestamps of files this app created, E174.1 is
       * a disk-space check to write safely, 35F9.1 is boot time for measuring elapsed intervals.
       */
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
          NSPrivacyAccessedAPITypeReasons: ['E174.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
          NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
        },
      ],
    },
  },

  android: {
    package: BUNDLE_ID,
    predictiveBackGestureEnabled: false,

    /*
     * Adaptive icon: two layers the launcher masks and parallaxes independently, which is why
     * the foreground keeps its alpha instead of being flattened like the iOS one.
     *
     * The artwork sits at 62% of the canvas rather than filling it. An adaptive icon is a
     * 108dp square of which only the centre 72dp survives EVERY mask shape a launcher might
     * apply — so art drawn edge to edge gets its rim cropped on any device using a circle.
     *
     * `monochromeImage` is the Android 13+ themed-icon layer, a flat white silhouette that the
     * system recolours to the user's wallpaper palette. Without it a themed launcher falls back
     * to shrinking the full-colour icon inside a grey blob, which looks broken next to apps
     * that supplied one.
     */
    adaptiveIcon: {
      foregroundImage: './assets/icon/adaptive-foreground.png',
      /*
       * A real gradient rather than `backgroundColor` alone. The icon's oxblood radial is half
       * of what makes it read as pressed wax; a flat fill behind the ring loses it, and Android
       * is the platform where this icon is most often seen.
       *
       * `backgroundColor` stays as the fallback a launcher uses if it declines the image.
       */
      backgroundImage: './assets/icon/adaptive-background.png',
      monochromeImage: './assets/icon/adaptive-monochrome.png',
      backgroundColor: '#14090B',
    },
    /*
     * Android has no out-of-process picker equivalent, so the permission is required for the
     * system picker to return anything. It is the only contacts permission requested, and
     * READ_CONTACTS is the read-only one — no WRITE_CONTACTS anywhere.
     */
    permissions: ['android.permission.READ_CONTACTS'],
  },

  // withDebugKeystore replaces Expo's shared debug keystore with ours, so the Android
  // SHA-1 is unique to this project and can be registered with Google OAuth.
  plugins: [
    'expo-router',
    'expo-font',

    /*
     * The launch screen. `_layout.tsx` already calls `preventAutoHideAsync` and holds it until
     * the fonts resolve — but nothing configured what is shown during that hold, so it was the
     * default WHITE screen. On a dark-only app that is a full-brightness flash on every cold
     * start, straight into a near-black first frame.
     *
     * `backgroundColor` matches `color.bgBase` exactly, so the splash and the first rendered
     * frame are the same colour and the handover is invisible.
     */
    [
      'expo-splash-screen',
      {
        image: './assets/icon/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: '#0A0405',
      },
    ],

    /*
     * Android notification icon. Android draws these as a SILHOUETTE from the alpha channel and
     * ignores colour entirely — hand it a full-colour icon and every notification shows a solid
     * grey-white blob. This is the same seal reduced to flat white on transparent, plus the
     * gold accent Android tints the small icon and header with.
     */
    [
      'expo-notifications',
      {
        icon: './assets/icon/notification-icon.png',
        color: '#B8963C',
      },
    ],
    './plugins/withDebugKeystore',
    // Android 11+ package visibility. Without it, UPI app discovery silently finds nothing.
    './plugins/withUpiQueries',
    // Google Sign-In's Swift deps cannot link statically without module maps; pod install
    // fails outright without this.
    './plugins/withModularHeaders',
    /*
     * Crash reporting. The plugin wires the native SDK and, on a release build, uploads source
     * maps so a stack trace names our files instead of one line of minified bundle.
     *
     * A Sentry project now exists and `EXPO_PUBLIC_SENTRY_DSN` is set, so crashes will arrive.
     *
     * ⚠️ **Source maps will NOT upload yet** — `project` is still missing, so every stack trace
     * arrives as one line of minified bundle, which is close to useless for the thing a beta
     * exists to do.
     *
     * `organization` is the slug from the dashboard subdomain (`pranav-yarasi.sentry.io`), NOT
     * the `o4511802768228352` in the DSN — that is the numeric id, and the plugin wants the
     * slug. Same trap for the project: the DSN's trailing path is its id, and the slug has to
     * come from `pranav-yarasi.sentry.io/settings/projects/`.
     *
     * The upload also needs `SENTRY_AUTH_TOKEN`. That one IS a secret — it belongs in EAS
     * environment variables and must NEVER be written here, because this file is committed.
     */
    [
      '@sentry/react-native/expo',
      {
        organization: 'pranav-yarasi',
        // TODO: the project SLUG, from Settings → Projects. Not the id in the DSN.
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },

  /*
   * The EAS project this app builds under.
   *
   * Written by hand because `eas init` cannot edit a dynamic config — it creates the project,
   * prints the id, and stops. Not a secret: it identifies a project, and every build already
   * requires an authenticated account to touch it.
   *
   * It must match `owner` above. If either changes without the other, builds fail with an
   * ownership error rather than anything that names the real cause.
   */
  extra: {
    eas: {
      projectId: '26bd5f99-4c68-41a9-828c-59b316decf36',
    },
  },
};

export default config;
