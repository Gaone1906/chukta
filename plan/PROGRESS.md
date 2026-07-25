# Hisaab — build progress

Single place to answer "where are we". Update the status table and the log at the end of
every phase. Each phase has its own file in this directory with the detailed work list.

**Last updated:** 2026-07-25 (Phase 7 done, then a round of fixes from actually using it)

## Where we are, in one screen

**8 of 12 phases done.** 22 migrations, 98 pgTAP tests, 120 TypeScript tests, all green. Tree
clean, everything pushed.

The whole money loop works and has been walked on a device: sign in → profile → Home → add an
expense in any of the five split types → see it agree on Home, the group and the person → edit
it → delete it → settle up. Everything behind the profile button works too: Settings, Invite,
Tip jar, Help, About.

**iOS is the active target.** Both platforms build and run; the Android emulator is deliberately
shut down (see "Commands that actually work"). Simulator: iPhone 17 Pro,
`BB49D14F-3053-4A4E-BDB3-A294A8578AFB`.

**Next:** Phase 8, offline & realtime. Get the Apple enrolment moving in parallel — it has the
longest lead time of anything on the blocked list.

> **The strongest lesson from this stretch, and it should change how the next phase is
> verified.** Nearly every real bug found recently came from *using* the app, not from tests —
> a person you had just named being invisible to the entire app, "Create group" sitting dead
> with no explanation, the ripple's veil rendering behind the screen it was meant to cover.
> The suite was green through all of it, because each one was a gap *between* correct parts.
> Budget a walkthrough at the end of every chunk, not just at the end of a phase.

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
| 3 | Supabase backend | [phase-03-backend.md](phase-03-backend.md) | ✅ done (22 migrations, 98 pgTAP) | 2 wk |
| 4 | Auth & onboarding | [phase-04-auth-onboarding.md](phase-04-auth-onboarding.md) | ✅ done (Google verified to the account picker; Apple needs a paid team) | 1 wk |
| 5 | Core loop | [phase-05-core-loop.md](phase-05-core-loop.md) | ✅ done (5A–5J; whole loop verified on Android) | 3 wk |
| 6 | Settle up & UPI | [phase-06-settle-upi.md](phase-06-settle-upi.md) | ✅ built (6A–6C); needs a physical device to close | 1 wk |
| 7 | Sidebar surfaces | [phase-07-sidebar-surfaces.md](phase-07-sidebar-surfaces.md) | ✅ built; tipping blocked on developer accounts | 1.5 wk |
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
| 3 | Domain for Universal Links / App Links (invite deep links). Links are built and shareable; they open a web page rather than the app until the association files are published. | Phase 11 | open |
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

# iOS screenshot, when you need to control the timing yourself rather than via a tool call
xcrun simctl io <UDID> screenshot /tmp/s.png && sips -Z 400 /tmp/s.png --out /tmp/s_small.png

# Android: boot, build, run. NOTE: the emulator is currently SHUT DOWN on purpose — iOS is the
# active target and qemu was eating the machine. Only boot it when testing Android specifically.
$ANDROID_HOME/emulator/emulator -avd Medium_Phone_API_36.1 -no-snapshot-save -no-boot-anim &
cd apps/mobile && npx expo run:android --no-bundler     # ~3-6 min incremental
npx expo start --dev-client --clear
adb reverse tcp:8081 tcp:8081                            # required each boot
adb exec-out screencap -p > /tmp/s.png                  # screenshot

# Kill the Android emulator (it does not stop cleanly on its own)
adb -s emulator-5554 emu kill; pkill -f "emulator/qemu"; pkill -f netsimd

# Database. `db reset` also wipes auth.users, so seeding is THREE steps, not one — see trap 17.
npx supabase db reset && npx supabase test db            # local, 98 pgTAP tests
ANON=$(grep EXPO_PUBLIC_SUPABASE_ANON_KEY apps/mobile/.env.local | cut -d= -f2-)
curl -s -X POST "http://127.0.0.1:54321/auth/v1/signup" -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@hisaab.test","password":"hisaab-dev-password"}' -o /dev/null
docker exec -i supabase_db_hisaab psql -U postgres -d postgres < supabase/seed.sql

# Query the local DB directly (the container is lower-case `hisaab`, and psql is not on PATH)
docker exec supabase_db_hisaab psql -U postgres -d postgres -c "select ..."

# Regenerate the typed schema after ANY migration, or the client will not compile
npx supabase gen types typescript --local > packages/core/src/db-types.ts

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

17. **`supabase db reset` wipes `auth.users` too, so the seed can never attach on a fresh
    reset.** `seed.sql` ends with a DO block that hangs the fixtures off the signed-in dev
    profile, and its own notice says "sign in once, then re-run db reset" — which cannot work,
    because the second reset deletes the account the first one needed. The working sequence is
    in "Commands that actually work": reset, create the dev user through the auth API, then
    apply `seed.sql` directly. Symptom if you get it wrong: the app loads, signs in, and shows
    an entirely empty Home.

18. **A transformed view can outrank a later sibling.** Giving the navigator a `transform` for
    the ripple's settle-back gave it its own layer, which rose above the ripple overlay that
    was supposed to cover it — so the veil hid nothing and the navigation swap happened in
    full view. Any overlay that must stay on top needs an explicit `zIndex`; sibling order is
    not enough once transforms are involved.

19. **Never animate layout properties.** The ripple used to animate `width`, `height`,
    `borderRadius`, `left` and `top` on four views at once, forcing a re-measure every frame
    while the incoming screen was mounting. Lay the view out once at its final size and move
    it with `transform` and `opacity` only — those are compositor-only and need no layout pass.

20. **An animation shorter than a tool round-trip cannot be observed by screenshot.** At 900ms
    every screenshot landed after the ripple had finished, which read as "the ripple never
    runs" and cost two wrong diagnoses. To debug motion: raise `motion.ripple.duration` to
    20–30s, paint the moving layer a garish colour, THEN capture. Restore both afterwards.

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

In the order it bites, not the order it was raised:

1. **Rotate every credential.** The Supabase secret key, the database password and the Google
   client secret were all shared in plain text during setup. Deliberately deferred so the test
   build could proceed — this is a hard gate before anything public, not a nice-to-have. Steps
   in `docs/setup-services.md` → "Rotating a leaked credential".
2. **Developer accounts.** Apple enrolment can take days, so it is the longest lead time here
   and worth starting before it blocks anything. Until it exists, Sign in with Apple cannot be
   demonstrated at all (it needs the entitlement) and the tip jar cannot complete a purchase.
3. **A physical Android phone with GPay or PhonePe.** The only way to close Phase 6: whether a
   real UPI app opens prefilled, whether the picker shows real icons, whether the QR scans.
   Also settles the Android blur question (open item #7).
4. **A domain**, for iOS Universal Links / Android App Links. Invite links are built and
   shareable but open a web page rather than the app until the association files are hosted.
5. **A hosted Supabase project** for anything off this Mac — the local stack is Docker here.
6. **The store display name** ("Hisaab" is taken). Only blocks Phase 11.

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

### Phase 7 — Sidebar surfaces — ✅ built, 2026-07-25

All six surfaces exist and every sidebar row navigates. Walked end to end on the iOS simulator
against local Supabase with the dev seed.

**What exists**

| Piece | Where |
|---|---|
| Sidebar drawer | `features/sidebar/Sidebar.tsx` |
| Settings | `(app)/settings.tsx`, `features/settings/{SettingsGroup,EditFieldSheet,DeleteAccountSheet}` |
| Invite friends | `(app)/invite.tsx`, `features/invite/{inviteLink,usePendingInvite}` |
| Tip jar | `(app)/tip.tsx`, `features/tip/purchases.ts` |
| Help | `(app)/help.tsx` |
| About | `(app)/about.tsx` |
| Backend | `0020_sidebar_surfaces.sql`, `0021_public_api_phase7.sql`, `tests/sidebar.test.sql` |

**Backend was almost all already there.** Phase 3 built `profile_claims`, `notification_prefs`
and `feedback`, and 0010 granted the self-scoped writes with column-level grants plus RLS — so
profile edits, the notification toggles and the feedback box are ordinary table writes with no
RPC layer. Only three things needed writing: `create_invite_link`, `delete_account`, and the
`tip_jar_purchases` table.

**Verified on device, not just written**

- Editing the UPI ID round-trips: `profiles.upi_vpa = 'pranav@okhdfcbank'` after a save.
- A notification toggle lazily creates the row: `notification_prefs.comments = false` with no
  row beforehand.
- Tapping Invite on a placeholder mints a claim with **only** the 32-byte SHA-256 stored, and
  opens the real iOS share sheet with the personalised message.
- The sidebar version reads `1.0.0` from `expo-constants` — not the prototype's hardcoded
  `v1.0.3`, which disagreed with its own About screen.

**Deviations from the phase plan, all deliberate**

- **No `pg_trgm` name search over all users.** The plan called for one; a fuzzy search across
  every profile is a user-enumeration API. Finding a specific existing person already works
  through `upsert_contact_profile`, which matches an **exact** contact point — you have to know
  their email rather than guess at their name.
- **Currency is shown, not editable.** v1 is INR-only and enforced by a CHECK on every money
  row; a picker that cannot work would be a lie about the app.
- **Five notification toggles, not the prototype's three.** The table has five, and the two the
  prototype omits (edits, comments) are the ones people most want to turn off.
- **Deletion is confirmed by typing `DELETE`**, not a second tap. There is no undo and no grace
  period, so a tap sitting where the previous tap just was is too easy.
- **The FAQ's currency answer is rewritten.** The prototype answers "a group holds one
  currency", implying a per-group setting that does not exist.

**Blocked, and why**

- **Tipping cannot complete.** It needs products in App Store Connect and Play Console, which
  need paid developer accounts. `features/tip/purchases.ts` is the seam: when
  `EXPO_PUBLIC_REVENUECAT_KEY` exists, `isTipJarConfigured()` flips and `purchase()` gets a
  body — no screen changes. The button says so rather than failing at the tap.
- **Invite links do not open the app yet.** They are https URLs pointing at the GitHub Pages
  site (`EXPO_PUBLIC_INVITE_ORIGIN`), and Universal Links / App Links need the association
  files on a domain we do not own — open question #3. Chosen over a `hisaab://` scheme
  deliberately: a custom scheme fails *silently* when the app is not installed, which is the
  entire audience for an invite. `usePendingInvite` already redeems a token from either form.
- **Rate Hisaab** says "once Hisaab is on the store" rather than being a dead button.
  `expo-store-review` is a native module and there is no listing to link to. Phase 11.

**Bug found and fixed while verifying, worth remembering**

`GlassSurface`'s `contentStyle` lands on the **inner** view. A `marginTop` there pads the
content and leaves the card itself flush against whatever is above it. Five Phase 5 screens had
this — group detail, person detail, settle up, and both cards on expense detail — so their
summary cards had been sitting tight under the header with a large gap inside since Phase 5.
Margins now go on `style`; `contentStyle` is padding and gap only.

Also fixed: the Settings switch was writing a Reanimated shared value **during render**, which
warns and restarts the animation on any re-render. Now a `useDerivedValue`.

### Fixes from actually using it, 2026-07-25

Found by the user walking the app rather than by a test. Worth reading before Phase 8, because
two of them are about *reachability* rather than correctness — the code worked and nobody could
get to it.

**Adding a person had no visible door.** The capability existed: type a name into the picker's
search box that matches nobody, and an "add them" row appears. Nothing said so, and the row was
invisible until the exact right thing had been typed. There is now a `+ Add someone` action
beside `+ New group` and a permanent last row in the people list, both opening
`features/people/AddPersonSheet.tsx`.

A sheet, not a route, and the reason generalises: these screens are *holding a selection* —
the picker's ticked people, the group's member list — so navigating away and back would either
lose it or need state threaded between routes. The sheet hands the new id straight back and the
caller ticks them, so the tap that adds someone is the tap that picks them.

**And that flow was broken underneath.** `get_home_summary` returned exactly two kinds of
person: someone you share a group with, and someone you share an expense with. Both require
history. So a freshly named person was invisible to the entire app the moment you left the
picker, and the expense form showed **"Someone"**, because that summary is where it resolves
names. `0022_home_includes_new_placeholders.sql` also returns unclaimed placeholders you
created yourself — narrow on purpose, and it stops being special the instant they sign up. The
test suite asserts the boundary too: somebody else's placeholder stays invisible, because this
must not become a directory.

> Both of these are the same shape: **a capability that exists in the schema but has no path to
> it in the UI is not a feature.** Phase 3 built placeholder identity, claim-in-place and
> merge-on-signup — the hardest part — and until now the only way to reach any of it was a
> search box that happened to match nobody.

**"Create group" looked broken.** Selecting members left the button dead, because a group needs
a name and nothing said so. The caption under it now explains, in gold rather than as a grey
aside — it is the reason the button above it is disabled, so it has to be read.

**The ripple is now every forward transition except the sidebar.** `rippleFrom(event, …)` takes
the press event straight from any `onPress`, so `GlassButton` and `EmptyState` ripple without
their screen measuring anything. Previously only Home's rows and the FAB rippled and everything
else cut instantly, which is what read as inconsistent.

**The jank had a real cause, and it is worth not repeating.** The veil and its three rings
animated `width`, `height`, `borderRadius`, `left` and `top` — all **layout** properties, so
every frame forced a re-measure and re-position, on top of whatever the incoming screen was
doing as it mounted. They are now laid out once at full size and moved by `transform` and
`opacity` only, which the compositor handles with no layout pass at all. Same easing, same
maths, same 900ms. **Never animate layout properties in this codebase; scale a fixed-size view
instead.**

**Also fixed:** `GlassSurface`'s `contentStyle` lands on the inner view, so a `marginTop` there
pads the content and leaves the card flush against whatever is above. Five Phase 5 screens had
it. And the Settings switch was writing a Reanimated shared value during render.

### The ripple: why it looked like it was not running

Worth writing down in full, because the diagnosis was wrong twice before it was right and the
same trap is waiting for anyone who touches this next.

**The symptom:** navigation felt instant everywhere; no ripple visible.

**The false leads.** Reduce Motion (`rippleTo` returns early when the OS asks for it) — off, per
the simulator's own plist. Then the context fallback: `useRippleNav()` returns a no-op
`rippleTo` outside a provider, which would navigate instantly and silently. Also fine — proven
by commenting out `fireNavigation` and watching the screen NOT change, which shows the ripple
was gating navigation all along.

**Why the measurements lied.** At 900ms the animation is shorter than one tool round-trip, so
every screenshot landed after it had already finished. The only way to see anything was to slow
it to 30 seconds and paint the veil red. **Do that first next time.**

**The three actual causes:**

1. **The sidebar destinations never rippled.** Settings, Invite, Help, About and Tip jar called
   `router.push` directly — so the five newest screens were exactly the five that cut instantly.

2. **The veil was rendering behind the screen.** Giving the content a transform (for the
   settle-back) gave it its own layer, which rose above its later sibling. The red-veil test
   showed the rows *through* the veil. An explicit `zIndex` on the overlay fixes it — and this
   is the general rule: **a transformed view can outrank a later sibling, so any overlay that
   must stay on top needs to say so explicitly.**

3. **There was almost nothing to see.** The veil is deliberately the exact colour the screens
   sit on — that is what hides the seam — so on a dark app it looks like nothing is happening.
   The only visible part is the trailing rings, and they were 1.1–1.6px hairlines: the prototype
   draws a 1px stroke *blurred* by up to 2.4px, and the port kept the 1px and dropped the blur.
   A blurred 1px line covers roughly `1 + 2b` px, which is the width they get now. The screen
   also settles to `scale .982` under the wavefront and back as it clears.

### Known, not yet fixed

- **Screen titles scroll away.** `ScreenHeader` sits inside the ScrollView on every detail
  screen, so the title and back chevron leave with the content. The prototypes pin the header
  and scroll only the body. Consistent across the app, so it is a fidelity gap rather than a
  bug — one contained change, since they all share `ScreenHeader`.

### Next: Phase 8 — Offline & realtime

`plan/phase-08-offline-realtime.md`.

**What already exists, so none of it needs designing again.** Phase 3 built the entire server
side of this: `internal.change_events` (one table serving realtime fan-out, the delta-sync
cursor and the push queue), `app.sync_pull(p_since_event_id, p_limit)` with a `public` wrapper,
and `internal.mutation_log` with every write RPC already opening with an idempotency check on
`client_mutation_id`. Every mutation the client makes already passes one. **Nothing on the
client consumes any of it yet** — that is the whole of Phase 8.

The conflict half is also already built and verified: `expenses.revision`, the `P0409` error
with the server snapshot in DETAIL, `ConflictError` in `lib/errors.ts`, and `ConflictSheet`.
What is missing is the outbox replaying into it.

**The pieces to build:** `expo-sqlite` + Drizzle for the read cache, a strictly-FIFO write
outbox, the reconnect order (drain outbox → pull deltas → resubscribe), and one Realtime
subscription filtered to the caller's own profile.

**The rule that must not be relaxed:** no auto-merge on money. A conflict returns the server
snapshot and the user chooses. Deletes beat edits. Comments and new expenses are inserts with
client-generated ids, so they never conflict in the first place.

### Also still open, from earlier phases

- **Task #43 — empty and error states.** The picker uses bare one-line text where Home uses
  `EmptyState`, and error states print raw PostgREST messages at users. Formally Phase 10, but
  the user raised it during Phase 5 and it has been waiting since.
- **Group members / group settings.** Never designed — the last hole from the original audit.
  The group detail screen's members row still goes nowhere. Needs a design decision before it
  can be built.
- **Screen titles scroll away** — see "Known, not yet fixed" above.
