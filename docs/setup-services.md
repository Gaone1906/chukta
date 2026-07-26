# External services you need to set up

Everything here needs a human — an account, a console, a password. Nothing in this file can be
automated, which is why it's written down rather than scripted.

**Never paste a key into chat.** Put the values in `apps/mobile/.env`, which is gitignored.
Copy `apps/mobile/.env.example` to get started.

Ordered by when it blocks work.

---

## 1. Supabase cloud project — needed to test on a phone

The database currently runs in Docker on this Mac. Your phone can't reach it, so a device
alpha needs a hosted project. Free tier is plenty.

1. Go to **https://supabase.com/dashboard**, sign in, **New project**.
2. Name it `hisaab`. Region: **Mumbai (ap-south-1)** — closest to your users.
3. Set a database password. Save it in a password manager; you'll need it to push migrations.
4. Wait ~2 minutes for provisioning.
5. Go to **Project Settings → API** and copy two values into `apps/mobile/.env`:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<the anon / public key>
   ```

> **Which key:** the one labelled **anon / public**. That key is *designed* to be embedded in
> the app — it grants nothing on its own, because every table is behind RLS.
>
> The **`service_role`** key is the opposite: it bypasses RLS entirely. Never put it in the
> app, never commit it, never paste it anywhere. It belongs only in Edge Function secrets.

6. Push the schema to it. `supabase link` needs a **personal access token** (an account-level
   credential, separate from the project keys) from
   https://supabase.com/dashboard/account/tokens:

   ```bash
   export SUPABASE_ACCESS_TOKEN=<your token>
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

   Without a token you can push straight over the database connection instead. **`?sslmode=require`
   is not optional** — without it the CLI looks for a project CA certificate that only `link`
   downloads, and fails:

   ```bash
   npx supabase db push --db-url \
     "postgresql://postgres:<url-encoded-password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require"
   ```

   URL-encode the password (`@` becomes `%40`). Note the direct endpoint is **IPv6-only** —
   the Supabase CLI copes, but `psql` from a Docker container will not reach it. Use the
   session pooler if you need a plain IPv4 connection.

---

## 2. Google sign-in — needed for Phase 4 to actually work

Free. Three OAuth client IDs, because Google treats each platform separately.

1. **https://console.cloud.google.com** → create a project called `Chukta`.
2. **APIs & Services → OAuth consent screen**: External, app name `Chukta`, your email as
   support and developer contact. Save. Leave it in Testing mode and add your own Google
   account under **Test users** — that's enough for alpha.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, three times:

   | Type | What to enter |
   |---|---|
   | **Web application** | No redirect URIs needed. This is the one Supabase wants. |
   | **Android** | Package name `com.chukta.app`, plus the SHA-1 below |
   | **iOS** | Bundle ID `com.chukta.app` |

   **Your Android debug SHA-1:**

   ```
   EB:58:89:84:CB:52:A7:31:7D:C7:A6:0D:4C:FE:F4:45:CB:0D:1B:1B
   ```

   > **Why this changed.** The first fingerprint came from the debug keystore Expo's prebuild
   > ships — which is the *same file in every Expo project*. Google enforces global uniqueness
   > on (package name + fingerprint), so registering `com.chukta.app` against a fingerprint
   > thousands of projects share fails with **"Ownership verification failed — the Android
   > package name and fingerprint are already in use."** Somebody else registered it first.
   >
   > `apps/mobile/credentials/debug.keystore` is now a keystore generated for this project
   > alone, and `plugins/withDebugKeystore.js` copies it in on every prebuild (otherwise
   > prebuild would overwrite it, since `android/` is regenerated).

   To read the fingerprint yourself — `keytool` is not on the PATH, it lives inside the JDK
   bundled with Android Studio:

   ```bash
   "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" \
     -list -v -alias androiddebugkey \
     -keystore apps/mobile/credentials/debug.keystore \
     -storepass android -keypass android | grep SHA1
   ```

   This is a *debug* certificate. The release SHA-1 is different and comes from the upload
   key EAS generates at first production build.

4. In the Supabase dashboard, go to **Authentication → Sign In / Providers** (under
   CONFIGURATION in the sidebar).

   > Not **OAuth Apps** — that page is for making your project an identity provider *for other
   > applications*, which is the opposite direction and easy to land on by mistake.

   Expand **Google** and toggle **Enable Sign in with Google**.

   | Field | Value |
   |---|---|
   | **Client IDs** | **all three** client ids — web, Android, iOS — comma separated |
   | Client Secret (for OAuth) | the **Web** client secret |
   | Skip nonce checks | **off** |
   | Allow users without an email | **off** |

   **Putting all three ids in that one field is not optional.** The app uses Google's native
   sign-in sheet, so the ID token it returns carries the *Android or iOS* client id as its
   audience — never the web one. Supabase rejects a token whose audience it does not
   recognise, so listing only the web id fails every sign-in with `Unacceptable audience in
   id_token` while the rest of the configuration looks perfect.

   The two toggles are both correct off, and neither is arbitrary:

   - *Skip nonce checks* exists for Sign in with Apple, where you generate the nonce yourself.
     Google's native library does not attach one, so there is nothing to mismatch. It weakens
     replay protection — turn it on only if a real nonce error appears.
   - *Allow users without an email* must stay off. The verified email becomes a contact point,
     and that is exactly what lets a friend's invite of "Priya" be claimed by the real Priya at
     signup. An account with no email can never be matched that way.

   Also add the Supabase callback to the **Web** client's Authorized redirect URIs in Cloud
   Console — unused by the native flow, but it removes a confusing failure if a web or
   email-link path is ever added:

   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```
5. Put the client IDs in `apps/mobile/.env`:

   ```
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...apps.googleusercontent.com
   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...apps.googleusercontent.com
   ```

   The Android client ID isn't referenced in code — Google matches it by package name and
   signing certificate — so the downloaded JSON is not needed anywhere.

   The iOS client also needs its **reversed client id** registered as a URL scheme, or the
   Google sheet opens and has nowhere to return to. That lives in `app.config.ts` under
   `ios.infoPlist.CFBundleURLTypes` and is already set. It is the `REVERSED_CLIENT_ID` value
   from the downloaded `.plist`.

   Neither the Android JSON nor the iOS plist contains a secret — only the **Web** client has
   one, and that belongs in the Supabase dashboard, never in the app.

---

## 3. Apple Developer Program — $99/yr, needed for Sign in with Apple

Not blocking yet. Google sign-in and the entire rest of the app work without it, and the iOS
*simulator* runs fine. You need this for Sign in with Apple, TestFlight, and running on a
physical iPhone.

Enrolment can take a few days, so worth starting before Phase 4 finishes.

1. **https://developer.apple.com/programs/enroll/** — enrol as an individual.
2. Once active: **Certificates, Identifiers & Profiles → Identifiers** → register
   `com.chukta.app` with the **Sign in with Apple** capability enabled.
3. **Keys → new key** with Sign in with Apple enabled. Download the `.p8` — **you can only
   download it once**, and it must never be committed (`.gitignore` already blocks `*.p8`).
4. Supabase dashboard → **Authentication → Providers → Apple**: enter your Team ID, the Key ID,
   the Service ID, and the contents of the `.p8`.

> App Store guideline 4.8 requires Sign in with Apple wherever another social login is offered.
> We offer Google, so Apple is mandatory before submission — but not before alpha.

---

## 4. Google Play Developer — $25 one-time, only for Play distribution

Not needed for an alpha: I can build an APK you install directly. Only required for the Play
internal testing track and, eventually, release.

**https://play.google.com/console/signup**

---

## 5. Xcode — installed, one command left

Xcode 26.6 is installed but the active toolchain still points at Command Line Tools. Needs
your password, so it can't be scripted:

```bash
sudo xcode-select -s /Applications/Xcode.app
```

Then `xcodebuild -version` should print 26.6. You can also delete the leftover
`/Applications/Xcode.appdownload`.

---

## Rotating a leaked credential

If a secret is ever pasted somewhere it shouldn't be — chat, a screenshot, a commit — rotate
it. Exposure is not undone by deleting the message.

- **Supabase secret key** (`sb_secret_…`): Dashboard → Project Settings → API keys → revoke
  and create a new one. Nothing in this repo uses it, so nothing breaks.
- **Database password**: Dashboard → Project Settings → Database → Reset password. Then
  re-run any `db push` with the new one.
- **Google client secret** (`GOCSPX-…`): Cloud Console → Credentials → your Web client →
  reset secret, then paste the new value into Supabase → Authentication → Providers → Google.
- **Supabase publishable key** and the **OAuth client IDs** are public by design. No action.

## Still undecided

- ~~**Store display name**~~ — settled on 2026-07-26. "Hisaab" was already three near-identical
  listings across both stores, so the app was renamed to **Chukta**, which turned up nothing.
  The bundle id `com.chukta.app` is fixed and cannot change once a listing exists. Confirm the
  name is still free in both consoles before creating them.
- **A domain**, for iOS Universal Links / Android App Links so invite links resolve when the
  app isn't installed. Also where the Terms and Privacy pages get hosted.
