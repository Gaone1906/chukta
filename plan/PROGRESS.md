# Hisaab — build progress

Single place to answer "where are we". Update the status table and the log at the end of
every phase. Each phase has its own file in this directory with the detailed work list.

**Last updated:** 2026-07-25 (Phase 5 done and verified on the emulator)

## Conventions

**Every commit is prefixed with its phase** — `Phase 3: add expense RPCs`. So
`git log --oneline | head -1` tells you which phase is in flight without reading anything
else, and `git log --oneline | grep '^.\{8\} Phase 2:'` pulls a phase's whole history.
Use `Phase 0:` for repo-level chores that belong to no feature phase.

---

## Status

| # | Phase | File | Status | Est. |
|---|---|---|---|---|
| 0 | Repo & scaffold | [phase-00-repo-scaffold.md](phase-00-repo-scaffold.md) | ✅ done | 2–3 d |
| 1 | Design system & motion | [phase-01-design-system.md](phase-01-design-system.md) | ✅ done (verified on Android **and** iOS) | 1 wk |
| 2 | `packages/core` money engine | [phase-02-core-money.md](phase-02-core-money.md) | ✅ done | 0.5 wk |
| 3 | Supabase backend | [phase-03-backend.md](phase-03-backend.md) | ✅ done (18 migrations, 77 pgTAP) | 2 wk |
| 4 | Auth & onboarding | [phase-04-auth-onboarding.md](phase-04-auth-onboarding.md) | ✅ done (Google verified to the account picker; Apple needs a paid team) | 1 wk |
| 5 | Core loop | [phase-05-core-loop.md](phase-05-core-loop.md) | ✅ done (5A–5J; whole loop verified on Android) | 3 wk |
| 6 | Settle up & UPI | [phase-06-settle-upi.md](phase-06-settle-upi.md) | ✅ built (6A–6C); needs a physical device to close | 1 wk |
| 7 | Sidebar surfaces | [phase-07-sidebar-surfaces.md](phase-07-sidebar-surfaces.md) | ⬜ not started | 1.5 wk |
| 8 | Offline & realtime | [phase-08-offline-realtime.md](phase-08-offline-realtime.md) | ⬜ not started | 1.5 wk |
| 9 | Push, FX, recurring, receipts | [phase-09-push-fx-recurring.md](phase-09-push-fx-recurring.md) | ⬜ not started | 1.5 wk |
| 10 | States & polish | [phase-10-states-polish.md](phase-10-states-polish.md) | ⬜ not started | 1.5 wk |
| 11 | Store release | [phase-11-store-release.md](phase-11-store-release.md) | ⬜ not started | 1.5 wk |

Phases 1, 2 and 3 have no dependencies on each other and can run in parallel.
Everything from 4 onward is sequential.

---

## Decisions already made — do not re-litigate

| Decision | Why |
|---|---|
| React Native + Expo, not SwiftUI | The design doc says iOS-native; that can't produce an Android app |
| Apple + Google auth for v1; Phone/OTP flag-gated | India SMS OTP needs TRAI DLT registration + a paid provider |
| Cached reads + write outbox, not a full sync engine | ~90% of "works offline" at a fraction of the cost |
| Supabase | Postgres for money math; Auth/Realtime/Storage/cron in one system |
| `profiles.id` is the universal identity, never `auth.users.id` | Lets invited-but-not-signed-up people be claimed in place, no migration |
| `bigint` minor units, largest-remainder allocation | Splits must sum exactly to the total; the prototype's `Math.round` loses money |
| Balances derived, not stored | A drifting balance table is worse than a few extra milliseconds |
| All money writes via `SECURITY DEFINER` RPCs | An expense is a six-table atomic write with a sum invariant |
| One `change_events` table for realtime + sync + push | One subscription per client; all three consistent by construction |
| Invites via native share sheet, no Contacts permission | Avoids a review-sensitive permission and a privacy manifest entirely |
| Tip jar is a **consumable** IAP | Non-consumables can only be bought once — nobody could tip twice |
| Web share-links for non-members: **out of v1** | Needs a public web surface + unauthenticated reads of expense data |
| **INR only for v1** | Scoped by the user. Money rows still carry a `currency` column, pinned by CHECK to 'INR' — see below |

---

## Open questions

| # | Question | Blocks | Status |
|---|---|---|---|
| 1 | Store display name — "Hisaab" is taken. Bundle id settled: `com.hisaab.app` | Phase 11 | name open |
| 2 | ~~Currency: Help FAQ vs feature spec~~ | — | **resolved: INR only for v1** |
| 3 | Domain for Universal Links / App Links (invite deep links) | Phase 7 | open |
| 9 | **Hosted Supabase project** — the local stack is Docker on this Mac, unreachable from a phone | device alpha | **needed from user** |
| 10 | ~~Google OAuth client IDs~~ | — | **done — provider enabled, verified** |
| 4 | Sentry for crash reporting — assumed yes | Phase 10 | assumed |
| 7 | **Android blur** defaults to the opaque fallback — a `BlurView` sampling a `BlurTargetView` SIGSEGVs the emulator's software GPU. Needs a physical device to confirm and flip. | Phase 10 | open |
| 8 | ~~Whole iOS side unrun~~ | — | **resolved: builds and runs on the iOS 26.5 simulator; the design renders correctly** |
| 5 | Apple Developer Program + Google Play enrolment | Phase 4 / 11 | user will do — see docs/setup-services.md |
| 6 | Legal review of `legal/terms.md` + `legal/privacy.md` before submission | Phase 11 | drafted, unreviewed |
| 11 | **ROTATE ALL CREDENTIALS BEFORE BETA.** The Supabase secret key, database password and Google client secret were shared in plain text during setup. Deliberately deferred by the user so the test build could proceed — this is a hard gate before any public build, not a nice-to-have. Steps: `docs/setup-services.md` → "Rotating a leaked credential". | **beta / any public build** | **MUST DO** |

---

## Currency: how INR-only is implemented

v1 supports rupees and nothing else. That is a scope decision, but the *shape* of the schema
is an engineering one, and the two are worth separating:

- **Kept:** a `currency char(3) NOT NULL DEFAULT 'INR'` column on every money-bearing row,
  with `CHECK (currency = 'INR')`. One column per table, costs nothing today.
- **Dropped:** `fx_rate`, `fx_rate_as_of`, `base_currency`, `amount_base_minor`,
  `currency_exponent`, the `fx_rates` table, and the FX refresh cron. All of it is complexity
  with no v1 payoff.

Why keep the column at all: retrofitting a currency onto a money schema later is genuinely
painful — every amount column needs one, every balance aggregation has to group by it, and
every historical row needs a backfill. Relaxing this later is the opposite: drop one CHECK
constraint, add the FX columns, done. The expensive half is already paid for.

`packages/core/src/fx.ts` is built and tested but **not wired into v1**. Leave it; it is what
gets switched on when the CHECK comes off.

---

## Log

### Phase 0 — Repo & scaffold — ✅ done, 2026-07-25

**Done**
- `git init`; first commit preserves the design handover byte-for-byte
- Restructured to `docs/`, `design-reference/{screens,assets}`, `plan/`, `legal/`
- `.gitignore` covering OS junk, node, Expo, signing material, secrets, build output
- `design-reference/README.md` — what ships, what's vendored, which screens don't exist
- npm workspaces monorepo: `apps/mobile` (Expo SDK 57), `packages/core`, `supabase/`
- GitHub Actions: typecheck, lint, test
- `legal/terms.md` and `legal/privacy.md` drafted
- Private repo `Gaone1906/hisaab` created and pushed; **CI green on first run**

**Deviations from plan**
- **Stripped web support from the Expo app.** The SDK 57 default template ships a demo app
  with web-only CSS modules that don't typecheck. Since this is iOS + Android only, removed
  `react-native-web`, `react-dom`, the web script and the demo screens rather than carrying
  a broken build.
- **`app.config.ts` replaces `app.json`.** Needed so the store display name can stay a
  variable (`APP_DISPLAY_NAME`) while the bundle id `com.hisaab.app` is fixed now — open
  question #1 is about the name, not the identifier. (Initially proposed as `club.uni.hisaab`,
  inferred from an email domain — wrong: this is a personal project with no org affiliation.)
- **eslint pinned to 9.x.** `eslint-plugin-react` (a transitive dep of `eslint-config-expo`)
  crashes on ESLint 10. Revisit when it ships a compatible release.
- **Kept `support.js` and `image-slot.js`** instead of deleting them. They are vendored
  prototype-viewer runtime; without them the reference screens can't be rendered in a
  browser, which the plan's own verification step requires. Documented in
  `design-reference/README.md` as third-party and never ported.
- Rewrote `./assets/` → `../assets/` in all 20 `.dc.html` files so they still resolve from
  `design-reference/screens/`.

**Left for later**
- Xcode is not installed yet (Command Line Tools only). Not blocking until iOS device/
  Simulator work in Phase 4. Android SDK is present.
- Apple/Google developer accounts not enrolled — blocks Phase 4 Sign in with Apple.

### Phase 1 — Design system & motion — ✅ done, 2026-07-25

**Done**
- `tokens.ts`, fonts (Rozha One + Hind), `GlassSurface` with three backends behind one switch,
  `AmbientBackground`, `Row`/`BalanceChip`, `SegmentedSwitcher`, `GlassButton`, `FAB`, `Seal`,
  `Toast`, and the `RippleReveal` transition.
- `@hisaab/core` gained `money.ts` + `format.ts` early — the balance chip needs en-IN
  lakh/crore grouping, and it is our own implementation rather than `Intl` because Hermes' ICU
  support differs across platforms.
- Kitchen sink at `src/app/index.tsx`: every primitive, a glass-backend picker, and a
  slow-motion ripple toggle.
- Verified on the API 36 emulator: fonts, ambient glow, switcher, rows, chips, settled badge,
  seal spinner→stamp, `₹12,34,56,789` grouping, and the ripple (circular mask, trailing gold
  ring, receding outgoing layer) all confirmed by screenshot.
- 23 tests green (13 money/format, 10 ripple maths); typecheck and lint clean.

**Findings worth carrying forward**
- **Android blur is off by default.** `BlurView` + `BlurTargetView` SIGSEGVs the emulator's
  RenderThread. Isolated: the target view alone is fine, adding the blur kills it. Almost
  certainly a SwiftShader limitation, but unprovable without hardware. See the long comment in
  `design/glassConfig.ts`.
- Over this design's smooth ambient gradient, blurred and opaque surfaces look nearly
  identical — the fill, hairline border and inner top highlight are what read as glass. So
  the Android fallback is an acceptable shipping state, not a stopgap.
- `expo-blur` changed API in SDK 57: `experimentalBlurMethod` → `blurMethod`, and Android now
  needs an explicit `blurTarget` ref or it silently renders no blur at all.
- Metro does not resolve `./foo.js` → `./foo.ts`. `packages/core` uses extensionless relative
  imports; adding a `.js` extension breaks the bundler while tsc and Vitest stay happy.
- The emulator's default 6GB data partition is too small for an 85MB debug APK; raised to 16GB.

### Phase 2 — `packages/core` money engine — ✅ done, 2026-07-25

**Done**
- `bigintMath.ts` — `floorDiv` (rounds toward −∞, unlike the built-in `/`) and `roundHalfEven`.
- `allocate.ts` — largest-remainder allocation with a `weight desc, key asc` tiebreak. Every
  split type, both currencies of every expense, and every pairwise debt route through it.
- `split.ts` — all five types reduced to one allocator call. Itemised flattens lines, then
  spreads tax/tip/discount pro rata to pre-tax subtotals, then sums per person.
- `fx.ts` — `parseRate` keeps ten decimal places exactly by parsing digits rather than going
  through `Number`; `allocateDualCurrency` converts once at the total and allocates in each
  currency with the same weights and tiebreak.
- `settle.ts` — `resolvePairwise` (net first, so a payer who also owes never self-edges) and
  `simplifyDebts` (exact-cancellation pass, then greedy max cash flow).
- `fixtures.ts` — 10 canonical allocation cases, **the contract with the plpgsql allocator**.

**90 tests green**, including property tests asserting: shares always sum to exactly the total
(all five types, any weights, negative totals included); no share is ever more than one unit
from its ideal; allocation is stable and order-independent; simplification preserves every net
balance and emits at most n−1 transfers; and both currency vectors sum exactly.

**Notes for Phase 3**
- `ALLOCATION_FIXTURES` / `fixturesAsJson()` are what `supabase/tests/allocator.test.sql`
  must assert against. If a fixture ever needs changing, the SQL implementation changes with
  it — they are not independently adjustable.
- Percentages are validated to sum to exactly 100 and are rejected otherwise, never
  normalised. The DB check constraint should match that, not silently rescale.
- Relative imports in this package stay extensionless. Adding `.js` satisfies tsc and Vitest
  but Metro cannot resolve it — verified again with `expo export` after this phase.

### Phase 3 — Supabase backend — 🟡 core landed, 2026-07-25

**Done** — 11 migrations, applying cleanly from scratch, 39 pgTAP tests green.
- Identity: `profiles.id` is the universal participant id; nothing outside `0002` touches
  `auth.users`. Placeholders are profiles with `user_id IS NULL`, claimed in place at signup.
- Expenses with a nullable `group_id` (one-offs), denormalised `group_id` on every child table
  so RLS policies stay flat, and `expense_debts` / `expense_participants` written in the same
  transaction.
- `app.allocate_minor` — **verified byte-identical to `@hisaab/core` against all ten fixtures**,
  including the reordered-keys tiebreak and the negative-total refund case.
- `trg_expense_balanced` — deferred constraint trigger asserting payers and splits both sum to
  the total at commit.
- `auth_ext` helpers breaking the `group_members` RLS recursion, and read policies on every
  table. **No write policies anywhere** — clients get SELECT only.
- `app.create_expense`: six tables, one transaction, one idempotency key, inline group
  creation. Plus `record_settlement` and `upsert_contact_profile`.
- Balances as views over a normalised pair ledger (`v_pair_ledger` → `v_group_balances`).
- CI now runs `supabase db reset` + `supabase test db` on every push.

**Bugs the tests caught**
- `= any (select fn())` parses as the set form, not the array form → `uuid = uuid[]`. Helper
  now returns `setof uuid` and policies use `in (select ...)`, which is also the form that
  actually becomes a once-per-statement InitPlan.
- `sum()` over `bigint` returns `numeric`, so `allocate_minor(...)` did not resolve. Cast added.
- A temp table inside a `search_path = ''` SECURITY DEFINER function cannot be resolved
  unqualified; rewrote `rebuild_expense_debts` to use plain aggregates instead.

**Completed in the second pass** — 15 migrations, 68 pgTAP tests.
- `update_expense` / `delete_expense` / `restore_expense` with `expected_revision`; a stale
  revision raises `P0409` carrying the server snapshot in DETAIL, so the client renders the
  conflict without a second round trip. Delete beats a concurrent edit.
- `expense_diff` precomputes which people's own shares moved — Phase 9's push pipeline uses
  that so a typo fix in the description notifies nobody.
- Signup trigger → `claim_or_create_profile`: a placeholder whose verified contact point
  matches is claimed IN PLACE. Plus `claim_placeholder` (invite token) and `merge_profiles`
  with collision handling, settlement voiding, and a tombstone.
- Read RPCs: `get_home_summary` (both tabs and every balance in one call),
  `get_group_detail`, `get_person_detail`, `simplify_group_debts`.
- `sync_pull` with a `full_resync` signal when the cursor falls outside retention.
- Storage buckets: private `receipts` gated on `can_read_expense`, public-read `avatars`
  writable only by their owner. Recurring rules with the `(rule_id, run_on)` idempotency key.
- `guardrails.test.sql` inspects the catalogue rather than trusting review: every SECURITY
  DEFINER function pins `search_path`, every write RPC calls `assert_signed_in()`, clients hold
  no write grants on any money table, and every public table has RLS with a policy.
- `packages/core/src/db-types.ts` generated from the live schema.

**Bug the conflict tests caught**
- `expense_diff` put a `GROUP BY` directly inside a scalar subquery, so it returned one row per
  person and raised `21000`. Wrapped the grouping in its own subquery.

**Deferred to Phase 9** (they need Edge Functions and cron, not schema)
- The notification drain, FX refresh (moot for now — INR only), and the recurring-expense
  runner. Their tables and the `next_recurrence` helper exist.

### Phase 4 — Auth & onboarding — 🟡 built and verified as far as possible, 2026-07-25

**Verified on the Android emulator, against the real local schema**
- Cold start lands on the entry screen; the seal, tagline, glass card and legal line all render.
- Dev sign-in creates an `auth.users` row → the signup trigger creates a profile → the client
  reads it back **through RLS** → routing lands in `(app)`. The whole chain works.
- A profile with no name is forced back into onboarding; profile setup renders, "Get started"
  is correctly disabled until the name is valid, and saving writes to the database.
- The completion screen plays its seal and shows the CTA.
- Google's button degrades to "Google sign-in not configured" instead of failing at the tap.

**Two real bugs found by running it**
- A route group needs its own `_layout.tsx`. `(app)/index.tsx` registered as `/` but rendered
  nothing — an entirely black screen with no error anywhere, which looks exactly like a crash.
- The completion screen was being skipped. Saving the profile clears `needsProfileSetup`, and
  the root guard then redirected out of `/done` before it could show — so the seal moment, the
  app's signature brand beat, never played. `done` is now excluded from that guard.

**NOT verified — needs the user**
- **Google sign-in**: no OAuth client IDs yet. The code path is written but has never run.
- **Apple sign-in**: needs the Apple Developer Program, and `xcode-select` still points at
  Command Line Tools.
- **Phone/OTP**: flag-gated off and needs an SMS provider; the screens render but the round
  trip is untested.

**Note:** `adb shell input text` lands in the RN TextInput only intermittently on this
emulator — a tooling quirk, not an app bug. Typed input was confirmed working in one pass.

### Google sign-in — verified as far as is possible without credentials, 2026-07-25

`external.google` is `true` on the project, and all three client ids (web, Android, iOS) are
registered against the project-owned SHA-1.

On the emulator: the button flips from "not configured" to a real **Continue with Google**,
and tapping it opens **Google's own sign-in screen** — no `DEVELOPER_ERROR`, which is exactly
what a wrong SHA-1, package name or client id produces immediately. Google has accepted the
app's identity. Backing out returns to the entry screen with no crash and no error toast, so
the `AuthCancelled` path behaves.

**Not completed, deliberately:** the emulator has no Google account (`Accounts: 0`), and
finishing the flow would mean entering the user's Google password. That last hop is theirs to
do — add a Google account to the emulator, or run the APK on a real phone.

**Note for Phase 11:** `hisaab-stamp.png` is 407 KB and visibly pops in over Metro in dev.
Bundled in release so it is not a runtime bug, but it reinforces that the stamp needs an
optimised variant.

---

# Context handoff — read this first after a context reset

Everything below is knowledge that is **not recoverable by reading the code**. It is the
result of things going wrong and being fixed.

## Environment

| Thing | Value |
|---|---|
| Repo | `~/Desktop/workspace/personal/Hisaab`, remote `Gaone1906/hisaab` (private) |
| Android AVD | `Medium_Phone_API_36.1` (data partition raised to 16G — 6G could not fit an 85 MB APK) |
| App id | `com.hisaab.app` |
| Supabase (hosted) | `https://khzjdtnagkaecbngjvoa.supabase.co` — schema **is** deployed |
| Supabase (local) | `npx supabase start`, Postgres on 54322, API on 54321 |
| Credentials | `apps/mobile/.env` — **gitignored**, hosted project |
| Local override | `apps/mobile/.env.local` — **gitignored**, points at local Supabase via `10.0.2.2`. Required for dev sign-in; delete it to go back to hosted |
| Xcode | 26.6, licence accepted, iOS 26.5 simulator runtime installed. CocoaPods 1.17 via Homebrew (system Ruby 2.6 is too old) |
| iOS simulator | `iPhone 17 Pro` — `BB49D14F-3053-4A4E-BDB3-A294A8578AFB` |

## Commands that actually work

```bash
# iOS. expo run:ios misidentifies a booted simulator as a device under Xcode 26, so drive
# xcodebuild directly. Simulator: iPhone 17 Pro, BB49D14F-3053-4A4E-BDB3-A294A8578AFB.
xcodebuild -workspace ios/Hisaab.xcworkspace -scheme Hisaab -configuration Debug \
  -sdk iphonesimulator -destination "platform=iOS Simulator,id=<UDID>" \
  -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO build
xcrun simctl install <UDID> ios/build/Build/Products/Debug-iphonesimulator/Hisaab.app
xcrun simctl launch <UDID> com.hisaab.app

# Android: boot, build, run
$ANDROID_HOME/emulator/emulator -avd Medium_Phone_API_36.1 -no-snapshot-save -no-boot-anim &
cd apps/mobile && npx expo run:android --no-bundler     # ~3-6 min incremental
npx expo start --dev-client --clear
adb reverse tcp:8081 tcp:8081                            # required each boot

# Screenshot (exec-out avoids a temp file on device)
adb exec-out screencap -p > /tmp/s.png && sips -Z 800 /tmp/s.png --out /tmp/s_small.png

# Database
npx supabase db reset && npx supabase test db            # local, 77 pgTAP tests
npx supabase db push --db-url "postgresql://postgres:<urlenc-pw>@db.<ref>.supabase.co:5432/postgres?sslmode=require"
```

`ANDROID_HOME=~/Library/Android/sdk` and `$ANDROID_HOME/platform-tools` must be exported in
every shell — they are not on the default PATH.

## Traps already hit — do not rediscover these

1. **Metro cannot resolve `./foo.js` → `./foo.ts`.** `packages/core` uses extensionless
   relative imports. tsc and Vitest accept `.js`; the bundler does not. Broke the app twice.
2. **`.expo/types/` is gitignored**, so CI has no generated route types. Never index
   `useSegments()` positionally — it is a tuple sized from those types and fails on a clean
   checkout. Use `usePathname()`.
3. **A route group needs its own `_layout.tsx`** or its screens render a blank black screen
   with no error anywhere.
4. **Android blur is off by default.** `BlurView` sampling a `BlurTargetView` SIGSEGVs the
   emulator's software GPU. `getGlassBackend()` returns `'fallback'` on Android; anything that
   renders a `BlurView` must check it (`RippleReveal` originally did not, and crashed on the
   first FAB tap).
5. **`adb shell input text` lands in RN TextInputs only intermittently.** Tooling flake, not an
   app bug. Tap, wait 3s, type, wait, then dismiss the keyboard.
6. **`sum()` over `bigint` returns `numeric` in Postgres** — cast when calling
   `app.allocate_minor`.
7. **A temp table cannot be resolved unqualified inside a `search_path = ''` function.**
8. **Do not put a `GROUP BY` directly inside a scalar subquery** — wrap it.
9. **PostgREST only exposes `public`.** Every RPC lives in `app`, so a client call resolves as
   `public.<name>` and fails with "Could not find the function ... in the schema cache". The
   client API is the wrapper list in `0018_public_api.sql`; a new client-callable RPC needs a
   wrapper there or it is unreachable from the phone.
10. **pgTAP tests must not assume an empty database.** The dev seed now populates the same
    database the tests run against; two tests were asserting global counts and a globally
    unique email, and broke the moment 5B landed. Scope every assertion to its own fixtures.
11. **Adding a native module needs a full rebuild**, not a Metro restart. `expo-clipboard`
    and `modules/upi` both hit this. The failure is misleading: the screen reports
    "Route ... is missing the required default export", and the real cause is a
    `Cannot find native module` a few lines earlier in logcat. Use
    `requireOptionalNativeModule` for anything with a fallback path.
12. **Android 11+ package visibility.** `queryIntentActivities` returns an empty list — not an
    error — without a matching `<queries>` block. Every UPI app looks uninstalled.
13. **React Navigation paints its own container background**, and the default theme's is
    `rgb(242,242,242)`. `contentStyle: 'transparent'` on the Stack is NOT enough — the light
    grey sits on top of the ambient background and the whole dark design disappears into cream
    text on near-white. Android escaped it; iOS did not. Fixed with a transparent
    `ThemeProvider` in the root layout. Import the theme from `expo-router`, not
    `@react-navigation/native` — SDK 57 vendors navigation as `standard-navigation` and that
    package is not in the tree.
14. **`expo run:ios` misidentifies a booted simulator as a physical device** under Xcode 26 and
    fails with "No code signing certificates are available". Drive `xcodebuild` directly
    against the simulator destination, then `xcrun simctl install`.
15. **`10.0.2.2` is Android-emulator-only.** The iOS simulator cannot resolve it. `.env.local`
    now uses the host's LAN IP, which works from both and from a physical phone.
16. **The emulator's "Try out your stylus" tutorial steals keystrokes** the first time a text
    field is focused, truncating input to one character. Looks exactly like an app bug. Cancel
    it once per emulator.

## Testing without real credentials

`src/features/auth/devSignIn.ts` (guarded by `__DEV__`) signs in with email/password against
**local** Supabase. Two links on the entry screen: *Dev sign-in* (fixed account) and *New
account* (random address, for first-run testing). Does not work against the hosted project,
which requires email confirmation.

The emulator has **no Google account**, so real Google sign-in cannot be completed here —
verified only as far as Google's own sign-in screen appearing, which already proves the
SHA-1 / package / client-id triple is accepted.

## Decisions that must not be re-litigated

- **INR only.** Money rows keep a `currency` column pinned by CHECK to `'INR'`.
  `packages/core/src/fx.ts` is built and tested but unwired.
- **UPI ID is optional at signup**, against the design doc's "required".
- **Balances are derived**, never stored.
- **All money writes go through `SECURITY DEFINER` RPCs**; clients hold SELECT only.
- **`profiles.id` is the universal identity**, never `auth.users.id`.
- Debug keystore is **committed on purpose** (`apps/mobile/credentials/debug.keystore`) so the
  Android SHA-1 is stable across machines; `plugins/withDebugKeystore.js` reinstalls it on
  every prebuild because `android/` is regenerated.

## Outstanding, blocked on the user

- **Rotate all credentials before beta** (open item #11) — deliberately deferred.
- Apple Developer Program — not buying until both emulators show a working app. Sign in with
  Apple therefore cannot be demonstrated at all (needs the entitlement).
- Store display name ("Hisaab" is taken); a domain for deep links.

### Phase 5 — done, 2026-07-25

All ten chunks built and the whole loop walked on the Android emulator against local Supabase
with the dev seed.

**What exists**

| Chunk | Where |
|---|---|
| 5A data layer | `src/lib/api.ts`, `queryKeys.ts`, `errors.ts` |
| 5B seed | `supabase/seed.sql` |
| 5C Home | `(app)/index.tsx` |
| 5D Group detail | `(app)/group/[id].tsx` |
| 5E Person detail | `(app)/person/[id].tsx` |
| 5F Picker + new group | `(app)/expense/who.tsx`, `(app)/expense/new-group.tsx` |
| 5G Expense form | `(app)/expense/new.tsx`, `features/expenses/{useExpenseForm,splitDraft,SplitEditor,PayerSheet,DateSheet,fields,FooterBar}` |
| 5H Detail / edit / delete | `(app)/expense/[id].tsx`, `(app)/expense/edit.tsx`, `features/expenses/ConflictSheet.tsx` |
| 5I Ripple navigation | `design/motion/RippleNav.tsx` |

**Verified on device, not just written**

- ₹100 split three ways writes `3334 / 3333 / 3333` — exactly ₹100. That is the bug the
  prototype has (`Math.round` per share) and the reason the allocator exists.
- Balances agree across Home, group detail and person detail, and move together after a write.
- Naming the group field on a one-off really does promote the participant set into a group.
- Edit bumps `revision` and records an `updated` row in `expense_revisions`.
- Delete soft-deletes; the group's balance then flips to what the surviving settlement says,
  which is derived balances behaving correctly rather than a bug.
- Empty states, the settled badge, and the error state all render (the error state was seen for
  real, courtesy of trap #9).

**What Phase 5 changed in the backend**

- `0016_group_mutations.sql` — `create_group` / `add_group_members`. Groups previously could
  only come into existence as a side effect of `create_expense`'s `new_group`, so the picker's
  "+ New group" escape hatch had nothing to call.
- `0017_expense_detail.sql` — `get_expense_detail`, one round trip for the screen the design
  set never had.
- `0018_public_api.sql` — the client API surface. See trap #9.

All three are applied to the hosted project as well as locally.

**Known rough edges, deliberately left**

- The ripple is a veil expanding over the outgoing screen rather than a mask revealing the
  incoming one — a router will not hand you both screens as nodes. Reads the same because the
  veil is the colour the screens already sit on. See the comment at the top of `RippleNav.tsx`.
- Receipts (`expense_attachments`) are read by `get_expense_detail` but nothing displays or
  uploads them yet — that is Phase 9.
- Settle up is still a toast on both group and person detail. Phase 6.
- Group members / group settings has no screen; `onMembers` in the prototype was bound to
  nothing and it still needs designing.

### Feedback to act on — empty and error states

Raised by the user, 2026-07-25, after a first run on a fresh hosted account: *"it's not
handling the empty cases well."* Deliberately deferred, not forgotten.

- The picker renders bare one-line text where Home uses the full `EmptyState` (title, body,
  action). Two different answers to the same problem in the same flow.
- A brand-new account is mostly dead space with no first-run guidance.
- Error states print the raw PostgREST message. Right in dev, wrong in front of a user — it
  needs a human sentence with the technical detail tucked behind something.

Phase 10 owns states and polish, but the picker/Home inconsistency is worth pulling forward.

### Phase 6 — built, 2026-07-25

Settle up, the UPI handoff, the QR fallback and the native picker all exist. `record_settlement`
was already tested; the screen, `packages/core/src/upi.ts` (property-tested), `modules/upi/`
and `plugins/withUpiQueries.js` are new.

Verified on the emulator: ₹1,350 marked settled flips the pair to All square, the QR renders
with correct finder patterns, and the "they owe you" direction correctly offers no UPI button
— you cannot reach into someone's phone and take money.

**Blocked on hardware, not on code:** whether a real UPI app opens prefilled, whether the
picker shows real icons, and whether the QR actually scans. All three need a physical Android
device with GPay/PhonePe installed.

### Both open bugs — fixed, 2026-07-25

Kept here because the *shape* of the first one will recur elsewhere.

**1. The expense form could strand you out of your own split.** `(app)/expense/new.tsx` built
its participant list as `return profile ? [me, ...others] : others;`. If `useSession().profile`
had not resolved on first render, the list was *only the other person* — and
`useExpenseForm`'s once-only seeding effect then locked `split.included` to that moment and
never revisited it, silently leaving you out of an expense you are part of.

Seen in the wild: an expense saved as `payer=Harshi:4000, splits=Harshi:4000`. Payer and sole
ower are the same person, so it netted to zero and moved nobody's balance — which looks
exactly like "it didn't record". **Never proven** to be this race rather than the user
deselecting themselves; the stored row is identical either way. The race was real in the code
regardless, which is what justified fixing it.

*Fixed by inverting the state.* `SplitState.included` is gone; `SplitState.excluded` holds
only the people the user explicitly took off, and `includedIds(participantIds, state)` derives
the rest **from whoever is on the screen right now**. There is no snapshot to take too early
and no moment at which the roster has to be declared final. `new.tsx` also stops building a
participant list at all without a profile — half a roster is wrong, not incomplete — and
treats a missing profile as part of `loading`, alongside the query.

> **The general rule, worth applying elsewhere:** anything derived from an async-arriving list
> must be *computed* from that list, never *seeded* from it. A seeding effect is a snapshot,
> and a snapshot of data that has not finished arriving is a race by construction. Store the
> user's exceptions, derive the default.

`splitDraft.test.ts` locks it in: nine cases, including "a participant who arrives after the
split state was created is included" and "a deselection survives a roster change".

**2. Nothing warned before saving a net-zero expense.** Now `useExpenseForm.netZeroWarning`
computes each person's `paid − share` and, when every one of them is zero, says so in gold
directly above the Save button — naming who, in the single-person case:

> Harshi paid ₹500 and is the only one splitting it, so nobody ends up owing anything.

Deliberately a warning, not a block: "I paid for my own thing" is a real thing to record, and
refusing it would be the app deciding it knows better. Verified on the iOS simulator in both
directions (you paid / they paid), and that it disappears the moment the split is normal.

### Next: Phase 7 — Sidebar surfaces

`plan/phase-07-sidebar-surfaces.md`. Settings, Add friend (share sheet), Tip jar, Help, About.
The Home profile button and the group members row are both still stubs pointing here.
