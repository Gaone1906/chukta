# Chukta — build progress

Single place to answer "where are we". Update the status table and the log at the end of
every phase. Each phase has its own file in this directory with the detailed work list.

**Last updated:** 2026-07-26 (renamed to Chukta; Phase A all but done)

## Where we are, in one screen

**10 of 12 phases done, and the app is now called Chukta.** 36 migrations, 206 pgTAP
assertions, 166 TypeScript tests, all green. Tree clean, everything pushed.

The whole money loop works and has been walked on a device: sign in → profile → Home → add an
expense in any of the five split types → see it agree on Home, the group and the person → edit
it → delete it → settle up. Everything behind the profile button works too: Settings, Invite,
Tip jar, Help, About.

**And it works with no server.** Every write goes through a durable queue, every read comes
from a persisted cache, and changes made elsewhere arrive live. Verified by stopping Supabase
under a running app — see the Phase 8 log.

**iOS is the active target.** Both platforms build and run; the Android emulator is deliberately
shut down (see "Commands that actually work"). Simulator: iPhone 17 Pro,
`BB49D14F-3053-4A4E-BDB3-A294A8578AFB`.

**Next:** Phase 9, push + recurring + receipts. Get the Apple enrolment moving in parallel — it
has the longest lead time of anything on the blocked list.

> **One thing Phase 9 must not forget.** Phase 8 removed the actor-exclusion from
> `internal.emit_change` so a second device on one account can converge. That rule has to be
> reapplied when the push queue is drained, or everyone gets a notification telling them what
> they themselves just did.

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
| 3 | Supabase backend | [phase-03-backend.md](phase-03-backend.md) | ✅ done (24 migrations, 115 pgTAP) | 2 wk |
| 4 | Auth & onboarding | [phase-04-auth-onboarding.md](phase-04-auth-onboarding.md) | ✅ done (Google verified to the account picker; Apple needs a paid team) | 1 wk |
| 5 | Core loop | [phase-05-core-loop.md](phase-05-core-loop.md) | ✅ done (5A–5J; whole loop verified on Android) | 3 wk |
| 6 | Settle up & UPI | [phase-06-settle-upi.md](phase-06-settle-upi.md) | ✅ built (6A–6C); needs a physical device to close | 1 wk |
| 7 | Sidebar surfaces | [phase-07-sidebar-surfaces.md](phase-07-sidebar-surfaces.md) | ✅ built; tipping blocked on developer accounts | 1.5 wk |
| 8 | Offline & realtime | [phase-08-offline-realtime.md](phase-08-offline-realtime.md) | ✅ built; verified against a stopped server | 1.5 wk |
| 9 | Push, FX, recurring, receipts | [phase-09-push-fx-recurring.md](phase-09-push-fx-recurring.md) | ✅ built & green; delivery needs a device. FX deliberately out (INR-only) | 1.5 wk |
| 10 | States & polish | [phase-10-states-polish.md](phase-10-states-polish.md) | 🟡 part done — empty + error states shipped; a11y and Android blur perf left | 1.5 wk |
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
| 1 | ~~Store display name — "Hisaab" is taken~~ | — | **resolved: renamed to Chukta, `com.chukta.app`** |
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
- Private repo `Gaone1906/chukta` created and pushed; **CI green on first run**

**Deviations from plan**
- **Stripped web support from the Expo app.** The SDK 57 default template ships a demo app
  with web-only CSS modules that don't typecheck. Since this is iOS + Android only, removed
  `react-native-web`, `react-dom`, the web script and the demo screens rather than carrying
  a broken build.
- **`app.config.ts` replaces `app.json`.** Needed so the store display name can stay a
  variable (`APP_DISPLAY_NAME`) while the bundle id `com.chukta.app` is fixed now — open
  question #1 is about the name, not the identifier. (Initially proposed as `club.uni.chukta`,
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
- `@chukta/core` gained `money.ts` + `format.ts` early — the balance chip needs en-IN
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
- `app.allocate_minor` — **verified byte-identical to `@chukta/core` against all ten fixtures**,
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

**Note for Phase 11:** `chukta-stamp.png` is 407 KB and visibly pops in over Metro in dev.
Bundled in release so it is not a runtime bug, but it reinforces that the stamp needs an
optimised variant.

---

# Context handoff — read this first after a context reset

Everything below is knowledge that is **not recoverable by reading the code**. It is the
result of things going wrong and being fixed.

## Environment

| Thing | Value |
|---|---|
| Repo | `~/Desktop/workspace/personal/Chukta`, remote `Gaone1906/chukta` (private) |
| Android AVD | `Medium_Phone_API_36.1` (data partition raised to 16G — 6G could not fit an 85 MB APK) |
| App id | `com.chukta.app` |
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
xcodebuild -workspace ios/Chukta.xcworkspace -scheme Chukta -configuration Debug \
  -sdk iphonesimulator -destination "platform=iOS Simulator,id=<UDID>" \
  -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO build
xcrun simctl install <UDID> ios/build/Build/Products/Debug-iphonesimulator/Chukta.app
xcrun simctl launch <UDID> com.chukta.app

# Watch an animation. It is shorter than a tool round-trip, so raise it FIRST (trap 20) —
# motion.ripple's beats live in design/tokens.ts. 20x makes each phase observable.
for i in 1 2 3 4 5 6; do xcrun simctl io <UDID> screenshot /tmp/w$i.png; sleep 1.4; done

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
npx supabase db reset && npx supabase test db            # local, 115 pgTAP tests
ANON=$(grep EXPO_PUBLIC_SUPABASE_ANON_KEY apps/mobile/.env.local | cut -d= -f2-)
curl -s -X POST "http://127.0.0.1:54321/auth/v1/signup" -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@chukta.test","password":"chukta-dev-password"}' -o /dev/null
docker exec -i supabase_db_chukta psql -U postgres -d postgres < supabase/seed.sql

# Simulate "no server" without touching the radio: stop the API gateway, leave Postgres up so
# you can still inspect it. This is how the whole offline layer was verified.
docker stop supabase_kong_chukta      # app can reach nothing
docker start supabase_kong_chukta     # and back

# The app's own storage on the simulator (outbox, cursor, cached reads)
CONT=$(xcrun simctl get_app_container <UDID> com.chukta.app data)
sqlite3 "$CONT/Documents/SQLite/chukta-offline.db" "select * from outbox; select * from sync_state;"
strings "$CONT/Documents/mmkv/chukta-query-cache" | grep -c __bigint__   # 0 means the cache never wrote

# Query the local DB directly (the container is lower-case `chukta`, and psql is not on PATH)
docker exec supabase_db_chukta psql -U postgres -d postgres -c "select ..."

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

21. **A persisted cache is worthless if screens prefer `error` to `data`.** TanStack keeps the
    cached data when a refetch fails — but every screen here rendered the error branch first,
    so a working offline cache showed a fetch stack trace instead of the ledger. The rule:
    **an error state is for having nothing to show**, not for a failed refresh of something you
    already have. `error && !data`.

22. **Nothing may act on `session` before `loading` is false.** It is null for the first render
    of every cold start, while the persisted session is being read, and code that treats that
    as "signed out" will do signed-out things — the offline provider wiped the write queue on
    every single launch. The root navigator has always waited on this flag; anything else that
    branches on the session must too.

23. **A failed request is not an answer.** `data` is null both when the server says "no such
    row" and when you never reached the server. Conflating them sent a signed-in user back to
    onboarding on a cold start with no network. Check `error` before believing a null.

24. **`realtime.send` swallows every exception into a WARNING.** That is what makes it safe to
    call inside a money-write transaction, and it also means a broadcast that is denied,
    malformed or lands on a missing partition looks exactly like success. Never assert that it
    "did not throw" — read `realtime.messages` back.

25. **`realtime.messages` and `realtime.send` are not ours.** The Realtime container installs
    them, so they are absent wherever Postgres runs alone — including CI, which uses
    `supabase db start`. Anything touching that schema must be guarded on its existence, or an
    unguarded trigger raises `undefined_function` on the first expense written and takes every
    write RPC down with it.

26. **Realtime authorises a subscribe against a synthetic probe row**, not against a real
    message. That row has `private = false` and null `payload`, `event` and `binary_payload` —
    so a policy containing `private is true` (the obvious thing to write) fails the probe and
    blocks every subscription, with an error that points at permissions rather than at the
    policy. Key off `realtime.topic()` and nothing else.

27. **CocoaPods needs a UTF-8 locale.** `pod install` dies with
    `Unicode Normalization not appropriate for ASCII-8BIT` unless `LANG=en_US.UTF-8` is set,
    which makes `expo prebuild` fail at its pod step. Run
    `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install` from `apps/mobile/ios` afterwards.

28. **Nothing that runs during an animation may touch React state.** The ripple kept its tap
    origin in `useState` on a provider that renders the whole navigator, and handed an
    unmemoized object to its context — so every navigation re-rendered every screen holding
    `useRippleNav()`, twice, at frame 0 and at the end. Origin, radius and progress are all
    shared values now and the overlay stays mounted. If a transition needs a value, it is a
    shared value.

29. **Never transform a view that contains glass.** The design's 1.8% settle-back was applied
    to the wrapper around every screen. `GlassSurface` resolves to Apple's Liquid Glass on
    iOS 26 and to a real `UIVisualEffectView` below it, so that asked the system to
    recomposite every glass material on screen on every frame of the transition. Move the
    effect onto something cheap that is already animating — the veil, in this case.

30. **A view with `borderWidth` + `borderRadius` and no clip falls off CoreAnimation's border
    fast path** and rasterises its border into a main-thread CGImage instead. Harmless at
    button size; the ripple's rings are laid out at the screen's diagonal, so it was a bitmap
    thousands of pixels square, three times, on the first frame of every transition.
    `overflow: 'hidden'` puts it back on the fast path.

31. **The ambient background is behind every blur surface, so while it moves nothing can be
    cached.** Four SVG blobs on infinite loops meant the blur backdrop was dirty every frame,
    app-wide, at rest as well as during transitions. It now pauses while the ripple plays.
    Anything else added behind the glass needs the same treatment.

32. **An ease-out can be too aggressive to read as motion.** `1-(1-t)^2.6` is 83% travelled at
    the halfway mark, so over a 440ms expand the wave crossed most of the screen in about a
    tenth of a second and then crawled — which looks like a flinch and a stall, not a sweep.
    A circular reveal does need an ease-out (area grows with the square of the radius), but a
    quadratic one. And the visible part of a transition should get most of the budget: the old
    900ms spent over half of itself on an invisible veil holding and fading.

33. **A sheet that builds its body when closed costs you the frame you were hiding.**
    `DateSheet` laid out a 42-cell month grid on every render of the expense form, mounted or
    not, including the screen's first render under the veil. Gate on `visible` and split the
    body out, the way `PayerSheet` does.

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
6. ~~**The store display name**~~ — resolved on 2026-07-26 by renaming the app to **Chukta**,
   because "Hisaab" was three near-identical listings across both stores.

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
| 5H Detail / edit / delete | `(app)/expense/[id].tsx`, `(app)/expense/edit.tsx`, `(app)/pending.tsx` |
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
  files on a domain we do not own — open question #3. Chosen over a `chukta://` scheme
  deliberately: a custom scheme fails *silently* when the app is not installed, which is the
  entire audience for an invite. `usePendingInvite` already redeems a token from either form.
- **Rate Chukta** says "once Chukta is on the store" rather than being a dead button.
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

### Next: Phase 9 — Push, recurring, receipts

`plan/phase-09-push-fx-recurring.md`. FX is moot — INR only.

**What already exists.** Phase 3 built `internal.notification_queue` with its `coalesce_key` and
45-second delay, `public.device_tokens`, `public.notification_prefs` (read and written by
Settings since Phase 7, defaults applied client-side in `getNotificationPrefs`),
`app.expense_diff` for "only notify people whose own share actually moved", and the recurring
tables plus `app.next_recurrence`. What is missing is the drain: a `pg_cron` schedule, an Edge
Function, and the Expo Push call.

**The one thing that must not be forgotten.** Phase 8 removed the actor-exclusion from
`internal.emit_change` — the actor is now a recipient of their own events, which is what lets a
second device on one account catch up. That exclusion has to be reapplied **when the queue is
drained**, which is where it belonged all along. Without it, everyone gets a push telling them
what they themselves just did. `internal.change_events.actor_profile_id` is the field.

**Also worth knowing:** `notification_prefs` rows are created lazily, so "no row" means *all
defaults on*, not "everything off". The server drain must apply the same defaults the client
does.


### Phase 8 — Offline & realtime — ✅ built, 2026-07-26

The app opens and reads with no network, writes queue and flush on reconnect, and changes made
elsewhere arrive live. Verified by stopping the API gateway under a running app, which is the
only way most of this can be tested at all.

**What exists**

| Piece | Where |
|---|---|
| Realtime broadcast spine | `supabase/migrations/0023_realtime_broadcast.sql` |
| Client-generated ids | `supabase/migrations/0024_client_generated_ids.sql` |
| Sync tests | `supabase/tests/sync.test.sql` (17) |
| Local database | `src/lib/offline/database.ts` — outbox + sync_state, nothing else |
| Write queue | `src/lib/offline/{outbox,drain,writes}.ts` |
| Balance overlay | `src/lib/offline/effects.ts` + `people.ts` |
| Persisted reads | `src/lib/offline/persister.ts`, `serialize.ts` |
| Connectivity | `src/lib/offline/connectivity.ts`, `OfflineBanner.tsx` |
| Orchestration | `src/lib/offline/OfflineProvider.tsx` |
| Conflict inbox | `(app)/pending.tsx` |

#### Three deviations from the phase plan, all deliberate

**Reads are cached, not mirrored — and Drizzle is gone.** The plan called for `expo-sqlite` +
Drizzle mirroring ten server tables and recomputing balances locally with `@chukta/core`. But
every screen here is fed by one RPC that returns the whole screen with its balances already
computed by the server's views, so persisting those responses verbatim *is* the offline read
story. The plan's own requirement is that an offline balance must never disagree with an online
one — and the surest way to guarantee that is not to compute it twice. Mirroring would mean
reimplementing `v_pair_ledger`, `v_group_balances` and the soft-delete and settlement-voiding
rules in TypeScript and keeping them in step with the SQL forever. Two tables read by four
hand-written queries do not need an ORM either.

What the local database *is* for is the half that cannot be a cache: the writes that have not
happened yet. Those need ordering, durability across a force-quit, and a transaction.

**The live path is broadcast-from-database, not Postgres Changes.** `internal.change_events`
cannot participate in Postgres Changes at all — the `internal` schema has no USAGE for
`authenticated`, the table has no grants, no RLS and no publication. Every one of those is
deliberate and is what stops a client reading other people's fan-out. So a trigger mirrors each
event onto `sync:<recipient_profile_id>` via `realtime.send`, and a SELECT policy on
`realtime.messages` authorises exactly one question: is this your own topic. The table stays
sealed; only a projection leaves.

**Event payloads stay minimal.** The plan said comments and settlements should carry full
payloads for direct-apply. They do not, because the client invalidates query keys rather than
hand-patching cache entries — an expense touches six tables and moves balances on Home, its
group and both people in every pair it creates, and hand-patching that means reimplementing the
fan-out in TypeScript and eventually being wrong about it. A tick tells you to go and ask, and
a tick cannot leak: widening the payload would mean re-checking every field against RLS by
hand, since a broadcast bypasses the read policies that would otherwise gate it.

#### Backend gaps this phase closed

Three of these were invisible until something was actually listening.

- **The actor was excluded from their own events.** `emit_change` ended `where r is distinct
  from p_actor`, under the comment "never notify the actor about their own action" — a
  *notification* rule sitting in the *sync* spine. It made a second device on one account
  permanently unable to catch up, live or through `sync_pull`, since both read that table.
  **Phase 9 must reapply the exclusion when draining the push queue**, or everyone gets a push
  telling them what they just did.
- **Creating a group inline from the expense form emitted no group event.** A member who was on
  no split was written into `group_members` and told nothing at all — no event, no broadcast,
  nothing from `sync_pull`. They could not discover the group existed.
- **`add_group_members` notified only the arrivals**, so everyone already in the group held a
  silently stale roster.
- **`upsert_contact_profile` deduped only on an exact contact point**, so a retried add-person
  with no email created a new stranger with the same name every time. Nothing retried before;
  an outbox retries by design. It now takes a client profile id and a mutation key.

#### Verified on device, not just written

With `supabase_kong_chukta` stopped:

- Cold start opens straight onto Home with every group, person and balance from cache.
- An expense saves instantly and the balance moves by its queued effect: the server's 98083
  plus a queued 40000 rendered as **₹1,380.83**, and the banner read "1 change waiting to sync".
- The queued row survives a force-quit.
- On reconnect it lands **exactly once after six send attempts** — one expense row, one
  `internal.mutation_log` entry, carrying the client-generated id the outbox chose.
- Afterwards the overlay clears and the screen matches the server to the paisa (₹1,280.83
  against 128083).

Separately, a live private-channel subscribe returns `SUBSCRIBED` where it previously returned
`Unauthorized: You do not have permissions to read from this Channel topic`, and a broadcast
arrives carrying the same `event_id` that `sync_pull` uses as its cursor.

#### Four bugs found by using it, none of which a test would have caught

Worth reading in full — the shape recurs.

**Every cold start wiped the outbox.** `session` is null for the first render while the
persisted session is still being read, and the offline provider took that as "signed out" and
cleared the local database. An expense entered on a plane simply did not exist next launch,
silently, before a frame was drawn. The root navigator already waits on the same `loading`
flag — with a comment about bouncing to login and back. Same trap; there it costs a flicker,
here it cost somebody's money.

**A cold start with no network dropped you into onboarding.** The session is persisted, the
profile was not, and a *failed* profile fetch was indistinguishable from "this person has no
profile". So `needsProfileSetup` went true and a signed-in user landed on "Tell us who you
are". The profile is cached beside the session now, and an error is no longer an answer.

**Every screen threw away its cached data the moment a refetch failed.** The persister was
restoring the whole ledger correctly, and then each screen rendered `error` in preference to
`data` — so what the user saw with no network was a fetch stack trace where their groups had
been. Fixed with `error && !data` across seven screens.

**The retry backoff never grew.** `retryDelayMs` was passed the queue length rather than the
head row's attempt count; with one stuck write that is always 1, so it retried every two
seconds indefinitely. Caught by watching `attempts` reach 23 inside ninety seconds.

> The common thread, and it is the same one Phase 7 ended on: **each of these was a gap between
> two individually correct pieces.** The wipe is correct on sign-out. The loading flag is
> correct. The error state is correct. Nothing is wrong until you ask what happens when they
> meet. Reading the code will not find them; running the app without a server will.

#### What is NOT verified

- **Conflict resolution end to end.** `/pending` is built and the drainer parks conflicted rows
  with the server snapshot, but producing a real `P0409` needs two clients editing one expense,
  which needs a second account on a second device. The server half is covered by
  `conflicts.test.sql`; the inbox has been rendered but never fed a real conflict.
- **Two devices on one account.** The fan-out fix that makes it possible is tested in pgTAP and
  the broadcast was verified with a Node client, but two simulators against one account has not
  been run.
- **A real airplane-mode matrix on hardware.** Stopping the API gateway leaves the radio up, so
  `onlineManager` still reports online throughout — which exercises the transport-failure path
  but never the paused-query path or the "Offline" banner state. Those need a physical device.

#### Known, deliberately left

- `add_group_members` has no call site in the app, so it is not an outbox op. If group settings
  ever ship, design it as one from the start.
- `create_invite_link`, `claim_placeholder`, `delete_account`, the avatar upload and the
  settings toggles are online-only, each for its own reason — see the comment on `OutboxOp`.
- `api.ts` claims to be "the only place the app talks to the database". That was already untrue
  (the onboarding profile write, the Apple display-name backfill, two Storage uploads) and is
  worth naming rather than resting the outbox on an invariant that does not hold.

### Also still open, from earlier phases

- **Task #43 — empty and error states.** The picker uses bare one-line text where Home uses
  `EmptyState`, and error states print raw PostgREST messages at users. Formally Phase 10, but
  the user raised it during Phase 5 and it has been waiting since.
- **Group members / group settings.** Never designed — the last hole from the original audit.
  The group detail screen's members row still goes nowhere. Needs a design decision before it
  can be built.
- **Screen titles scroll away** — see "Known, not yet fixed" above.

---

# DONE this round (2026-07-26) — security, motion, rating, phone.ts

Commits `4ca1f5f`, `3737ee3`, `15682e9`. All pushed. Gate green throughout:
**117 pgTAP · 45 mobile · 114 core · typecheck 0 · lint 0.**

## ✅ The placeholder takeover — REPRODUCED, then fixed (`0025_validate_expense_participants.sql`)

It was real. The previous note called it "strongly indicated"; it is now **proven**, executed
end to end against a local stack before anything was changed. On the unpatched database
`claim_placeholder` returned `{"merged": true}` and `merge_profiles` absorbed the victim.

The chain, for the record: `upsert_contact_profile` is an email→UUID oracle → name that id in a
**one-off** expense (no `group_id`, so `assert_group_member` never runs and nothing else checked
at all) → that write creates a shared `expense_participants` row → `shares_context_with` is now
true → `create_invite_link` passes → `claim_placeholder` → `merge_profiles`. Irreversible.

**The fix is narrower than the first attempt, and the narrowing is the interesting part.**
`auth_ext.assert_known_profiles` gates **placeholders only**; claimed accounts pass freely.

- A placeholder can be absorbed, so naming one you neither created nor share context with is
  refused (`42501`).
- A claimed account **cannot** be merged (`merge_profiles` refuses any source with a `user_id`,
  `0013:207`), so there is no takeover to reach — and gating it would have broken the documented
  common case: add a friend by email, `upsert_contact_profile` finds they are already on Chukta
  and returns THEIR id, split with them immediately (`AddPersonSheet.tsx:68-71`).
- My first version gated everything, and `sync.test.sql` caught it — that suite bootstraps
  context between three real accounts with a one-off expense, i.e. it was *relying on the hole*.
  It now passes **unchanged**, which is the evidence the narrowing is right.

`update_expense` had the same hole (it replaces the split set wholesale) and shares the fix.
**Residual, accepted:** someone knowing your email can still put you on a one-off expense you
did not agree to. Spam-shaped, visible, and you can delete it. Closing it needs an accept-step,
which is a product decision, not a patch.

Two test fixtures created placeholders with a **null creator**, which `upsert_contact_profile`
never produces; made them resemble real rows. Regression tests added for both RPCs.

## ✅ The ripple (`3737ee3`)

Root cause was one value driving two things that want **opposite** curves. Fixed with three
independent shared values, one continuous segment each, **no `withSequence` anywhere**:
`veil` (ease-out, `cover`) · `wave` (**linear**, `cover+hold`) · `dissolve` (delayed).
Navigation fires from the veil's completion callback, replacing a `useAnimatedReaction` that
compared on every frame to catch one crossing.

`ringOpacity` was being passed the **leading edge's** progress for all three rings; each now
fades against its own lagged position. Hold moved 0.66 → 0.75.

Tokens: `expand` → **`cover`**, retimed `320 / 360 / 220` (900).

**Verified on device at 20×** (frames in the transcript): veil coverage grows smoothly and
monotonically with no plateau or cliff, three rings stay distinct and are still visibly moving
as they sweep off the edge.

## ✅ Back navigation (`3737ee3`)

`animation: 'none'` hard-codes `transitionDuration` to 0, so the swipe **was** firing and
popping all along — it just had nothing to interpolate. Now `slide_from_right`,
`animationDuration: 300`, `gestureEnabled`, `fullScreenGestureEnabled`, `animationMatchesGesture`.
Verified: a drag from **mid-screen** (x=120) pops. `rippleMath.test.ts` asserts
`hold >= 300` so the slide can never outlast the veil it hides under.

## ✅ Rate the app + `phone.ts` (`15682e9`)

`expo-store-review` added, **pod install + rebuild done**, real StoreKit sheet verified on the
simulator. **No success toast on the good path** — `requestReview()` resolves whether or not the
OS showed anything, so any confirmation would be a lie on most taps.

Fixed both bugs next door: `tip.tsx` never branched on `configured`; `purchases.ts` had no
`purchase()` export.

`packages/core/src/phone.ts` + 14 tests. Resolved ambiguity, asserted: **ten digits starting
`91` read as national**, not CC+8 — stripping it would mangle the live 91xxxxxxxx mobile series.

---

# ROUND 2 — claim codes, contacts, and a second security fix (2026-07-26, overnight)

Commits `2ca8398` → `4c6d309`, all pushed. Gate green: **143 pgTAP · 45 mobile · 114 core ·
typecheck 0 · lint 0.** **All six requested features are now done**, plus Phase 10's error
states and the two verification tasks that were outstanding.

## ⚠️ 0027 — the third door 0025 missed. Read this before touching identity code.

An adversarial review of the claim-code work found a **critical**, and it was not in the new
code — it was in the 0025 fix from earlier the same day.

`shares_context_with` is derived from `group_members` **and** `expense_participants`. 0025
gated the two expense writers and missed `add_group_members`, which writes the other table with
no validation at all. So the identical takeover still worked with one substitution: make your
own group, add the victim's placeholder to it, context forged. Reproduced end to end, then
verified severed — including that **both** claim doors (the new code and the pre-existing
invite link) refuse once the membership insert is blocked.

**That is four writers of those two tables: `create_group` (0016), `create_expense` and
`update_expense` (0025), `add_group_members` (0027). A fifth would reopen the whole class.**
The guard is a shared function (`auth_ext.assert_known_profiles`) precisely so it cannot be
forgotten again — call it in anything new that writes either table.

## ✅ Claim codes — `0026_claim_codes.sql` + UI

8 chars from a 32-char Crockford alphabet, 15-minute expiry, HMAC with an out-of-row pepper,
three-tier throttle (5/hr/actor, 20/hr/IP, global 500/5min breaker). 24 pgTAP tests.

**The two things that would be easy to break:**

1. **It RETURNS, it does not RAISE.** PostgREST runs each RPC in one transaction, so inserting
   the attempt row and then raising rolls the counter back — the throttle becomes a no-op whose
   test still passes. There is an assertion on the *committed* row count, not on the error.
2. **`throttled` is deliberately distinguishable from `invalid`,** which departs from the
   original plan. Re-derived: lockout is a fact about the caller's own attempt history, which
   they already know, so hiding it buys nothing and strands a real person who typo'd. Uniformity
   is required only where the distinction is a fact about somebody else — which is why wrong,
   expired and already-used still collapse into one answer.

Verified end to end on the simulator with two accounts: A added Kabir, split ₹3,000 with him,
generated `WYSX-G2YD`; B (empty ledger) typed it lowercase and hyphenated, got "You are Kabir
now", and Home showed "dev ₹1,500 YOU OWE". Placeholder tombstoned, split row repointed.

## ✅ Contacts — picker only

`Contact.presentPicker()` (the legacy `presentContactPickerAsync` is deprecated in SDK 57 and
**throws at runtime** — the plan predicted this needed checking). iOS's own UI states the
guarantee: "Chukta can only access the contacts you select" / "Allow access to 1 contact?".

The three promises moved together, as they had to: `legal/privacy.md`, `invite.tsx`'s on-screen
copy, and the phase-07 acceptance criterion. **Keep them in step** — the app contradicts its own
privacy policy otherwise.

Verified: picked a contact, got the name and `+91 98765 43210` → `+919876543210`, and confirmed
a *different* user adding that same number resolves to the **same** profile with exactly one
profile holding it. That convergence is the whole point of the normaliser.

## ✅ Conflict inbox, fed a real P0409 (was task 53)

Queued an edit offline at revision 1, had the other account edit the same expense (revision 2),
reconnected. The stale edit was **refused** — amount unchanged, so no money silently
overwritten. Banner went amber→red ("1 change needs you"), the inbox showed the server's
snapshot and both resolutions, and "Apply mine anyway" landed at revision 3 with **two**
`update_expense` rows in `internal.mutation_log` — the proof the retry rotated its mutation key
rather than replaying the stored refusal.

## ✅ Phase 10 error states (was task 43) + one real bug it found

The original note ("zero empty/error states exist anywhere") was stale — twelve of sixteen
screens already handled both. Two of the four gaps were in the core loop and are fixed;
`tip.tsx` and `settings.tsx` were left alone deliberately (their queries fail harmlessly).

**The bug that audit surfaced:** going offline showed users, verbatim,
`fetch failed: UnexpectedException: Could not connect to the server. (at
ExpoModulesCore/Promise.swift:56)`. `translateError`'s no-code branch passed the transport's own
message straight through. Now a `NetworkError` with human copy, original kept on `cause`.
**It is deliberately not a `ServerError`** so `isServerRefusal` still returns false and the
outbox still treats a dropped connection as retryable — inverting that would strand queued
writes permanently.

## Also fixed along the way

- **A missing native module blanked the ENTIRE app group.** expo-router evaluates every route
  file to build its tree, so a top-level `import` of an absent native module throws at module
  scope and no route renders. Observed on a stale dev client. `rate.ts` and `pickContact.ts`
  both `require()` lazily now. **Any future optional native module must do the same.**
- The claim screen sat under the status bar: `ScreenHeader` applies no inset, and every other
  screen puts it INSIDE the ScrollView with `paddingTop: insets.top + 14` on the content
  container. Follow that convention.

---

# NEXT UP

## Blocked on hardware — I cannot do these

- **Airplane-mode matrix on a physical device** (task 54). Needs a real phone.
- **UPI picker with real GPay/PhonePe** (Phase 6 close-out). Same.

## Not started

- **Phase 9** — push (queue-and-drain via `pg_cron` → Edge Function → Expo Push), FX poll,
  recurring expenses, receipts. `pg_cron` is stood up here; **add `internal.purge_claim_codes()`
  to that same schedule** — it is written and deliberately unscheduled.
  → *Done: scheduled at `0030:203`. Recurring expenses were cut from v1 — backend built and
  running, no UI; see `phase-11-store-release.md` §5b.*
- **Phase 11** — store submission: icons, screenshots, an iOS `PrivacyInfo.xcprivacy` (none
  exists, and contacts now makes one mandatory), Play data-safety entry, IAP review.
  → *IAP is cut from v1 (tipping ships off). Contacts must be declared as **collected**.*
- **Phase 10 remainder** — a11y pass and the Android blur perf check on a low-end device.

## Open decisions

- **Phone/OTP** stays out (decided 2026-07-26). If it returns: verify-before-lookup needs an SMS
  provider (TRAI DLT); `0002:52` is the invariant to re-read first.
- **`merge_profiles` is mathematically irreversible** — it SUMS colliding split rows (`0013:227`)
  and `row_counts` records nothing useful (`0013:307`). Worth recording enough to reverse one
  before any further low-entropy path is added.

## ⚠️ Still open item #11, before any public build

Rotate the Supabase secret key, the DB password and the Google client secret. They were pasted
in plain text and are compromised.

---

# PHASE 9 — IN PROGRESS, stopped mid-fix (2026-07-26)

**State: all committed and pushed through `5e070c1`; tree clean. ONE test failing.**
Everything below is reproducible from the repo; nothing here depends on remembering a session.

Commits: `21b98d6` 9A+9B · `cc23ff1` 9C · `31e2b99` push registration · `cb16bd4` receipts ·
`5e070c1` review fixes (`0028`, `0030`, new `0031`, test edits). Step 4 below is done.

## ✅ The failing test — resolved by fixing the mapping, not the fixture (`0032`)

`internal.wants_notification` mapped `group_added` → `new_expenses`, so Cy — who had turned new
expenses off — was never told a group existed, and then expenses started appearing in it from an
app that had never mentioned it. **Muting the chatter must not hide the room.**

Swapping the fixture to Bo would have made the test pass and left that behaviour in place. So
`group_added` got its own column instead: `notification_prefs.group_adds`, default true,
back-filled true, with its own Settings row ("Added to a group"). Membership is a different kind
of event from money moving — rare, high-signal, and the one notification that explains all the
others.

Making it unconditional was the other option and was rejected: an un-refusable category is how
people end up switching the OS permission off, which silences all six.

The test now asserts the property rather than the outcome — Cy, with `new_expenses = false`,
**is** told he was added, his own switch still holds, and turning `group_adds` off does suppress
it. Client side: `NotificationPrefs`, `DEFAULT_PREFS`, the `select`, the Settings toggle, and
regenerated `db-types.ts`.

## What Phase 9 contains now

| Piece | State |
|---|---|
| `0028_notifications.sql` | enqueue trigger, coalescing drain, quiet hours, `push_receipts` |
| `0029_recurring_runner.sql` | `app.run_due_recurring_expenses()` |
| `0030_cron.sql` | 4 pg_cron jobs, Vault-backed dispatch, service-role wrappers |
| `0031_diff_and_membership_events.sql` | fixes `expense_diff` + `add_group_members` |
| `0032_group_added_pref.sql` | `notification_prefs.group_adds` + remapped `wants_notification` |
| `0033_coalesce_window_and_purge.sql` | coalesce on `not_before`; `purge_sync_spine()` + its cron job |
| `supabase/functions/push-dispatch/index.ts` | Edge Function (written, never deployed) |
| `features/notifications/registerPush.ts` | client token registration |
| `features/expenses/receipts.ts` + `ReceiptStrip.tsx` | receipts |

**FX is deliberately NOT built.** v1 is INR-only by CHECK constraint, so there is nothing to
convert. That is a scope decision already recorded, not an omission.

## ✅ An adversarial review found 12 confirmed defects. All 12 are now fixed.

Every one was reproduced against the live database. The last two are closed by `0033`, and the
first of them was **worse than the review described**:

1. **The rate limit did not actually limit anything.** The review called the 60-second
   `created_at` window a storage concern, since the drain groups by `(recipient, coalesce_key)`.
   It is not — two rows under one key only collapse if they come due *together*, and under the
   hourly cap they never do. Walked through: `t=0` row A held an hour; `t=90s` a same-key event
   misses the 60-second window and queues row B, held an hour from *then*; the two fire 90
   seconds apart. **Twenty-one events in an hour became twenty-one pushes an hour later** — the
   one control whose whole job is to stop a storm reproduced it, just late enough that nobody is
   looking at the screen that would explain it.

   Fixed by asking the question that matters — *has this row gone out yet?* — i.e.
   `not_before > now()` instead of a wall-clock window. A pending row that is not yet due cannot
   have been delivered, so merging into it loses nothing. Two events genuinely 90s apart with
   nothing holding them back still produce two pushes; only the held case changes.

   **Reproduced both directions** before and after: old trigger → 2 pending rows, 2 distinct due
   times; new trigger → 1 and 1.

2. **Nothing purged anything.** `internal.purge_sync_spine()`, nightly at 03:43. Terminal
   notifications and `mutation_log` at 30 days, resolved `push_receipts` at 7, `change_events`
   at 30 — except those still pinned by an undelivered notification.

   That exception is load-bearing and was verified, not assumed:
   `notification_queue.event_id` is `on delete cascade`, so purging a change event **silently
   deletes any pending notification behind it** — proved by deleting one and watching the queue
   row vanish with no status change. Same shape as the `digest` bug this phase already shipped
   once. 30 days is safe by construction: `sync_pull` derives retention from `min(id)` rather
   than a constant (`0015:30`), and the client's own cache expires at 14 days.

**The other ten** (each with the reasoning in the migration comments): the
kind-blind debounce rewriting a pending `expense_added`; `p_limit` bounding rows instead of
coalesce groups so a group could straddle a tick; the double notification when `create_expense`
creates a group inline; `digest` being a status nothing drained (**this was the worst — my own
comment said "marked, not dropped" while the row was lost forever**; replaced with a
`not_before` hold); the sweep using `created_at` instead of `claimed_at`, which would have torn
held-back rows out of dispatch on every tick; a missing index on `(recipient_profile_id,
created_at)`; `restore_expense` writing a NULL diff so restores notified nobody; and in `0031`,
`expense_diff.shares_changed` missing people ADDED to or REMOVED from an expense — the two whose
share moved most — plus `add_group_members` never emitting an event the notification layer reads.

## ✅ Phase 9 is green — everything above is done

```
npx supabase db reset && npx supabase test db   →  Files=12, Tests=187, PASS
npm run typecheck && npm run lint && npm run test →  clean; 45 + 114 tests pass
```

(The earlier estimate of "179 once green" was low — the mapping fix and the two new review
fixes added assertions rather than just repairing one.)

`npm run db:types` had to be re-run after `0032`: the generated `packages/core/src/db-types.ts`
rejects an unknown column on upsert, so a schema change that touches a table the client writes
to is always a two-step.

**What is left for Phase 9 needs hardware, not code** — see below. Everything that can be
verified on this machine has been.

## Next, in this order

**Task ids are creation order, not priority. This list is the priority.**

1. **Task 70 — progressive blur vignette at the screen edges.** Content scrolls under the
   Dynamic Island in perfect focus. See the note below for how this is normally solved and the
   one trap in it.
2. **Task 69 — the `Someone` bug.** Diagnosed at the end of this file; on the app's primary
   path and 100% reproducible.
3. Phase 10 remainder: a11y pass, Android blur perf.
4. Phase 11: store submission, `PrivacyInfo.xcprivacy`, and **open item #11 — rotate the
   compromised keys**.
5. Optional: re-run the audit workflow against `0032`/`0033`.

### Task 70 — what "progressive blur" actually means, and the trap

Apple ships this natively as of **iOS 26**: `UIScrollEdgeEffect` / SwiftUI's
`.scrollEdgeEffectStyle` blur *and* dim content where it meets the status bar or a tab bar.
That is the exact complaint, and the platform's own answer — so **step 0 is checking whether we
can reach it** rather than rebuilding it. We already depend on `expo-glass-effect` and have a
`liquid` backend for iOS 26+ (`design/glassConfig.ts`). Precedent for checking first: RNS 4.26
shipped a Reanimated transition API that expo-router surfaced *none* of.

**The trap in the hand-rolled version.** A single `BlurView` under a gradient mask does not
work — it blurs *uniformly* and then fades in **opacity**, which reads as a fog patch with a
visible edge rather than focus dissolving. The technique is a stack of 4–8 absolutely
positioned blur layers, intensity stepping up toward the edge, each masked to a progressively
narrower band; that approximates a variable blur radius. Eased gradient stops, not linear — a
linear alpha ramp on blur bands visibly.

`@react-native-masked-view/masked-view` is already in (the ripple uses it).
**`expo-linear-gradient` is not** — adding it needs a dev-client rebuild, so schedule it with
anything else native. Reference implementation worth reading first:
[expo-progressive-blur](https://github.com/rit3zh/expo-progressive-blur).

**Android must not stack blurs.** `getGlassBackend()` already returns `fallback` there and
expo-blur needs a `blurTarget` ref; N stacked blurs is precisely the cost that switch exists to
avoid. Degrade to one gradient scrim.

Build it as **one design-system primitive** taking an edge and a height, not per-screen copies —
same reasoning that put every glass surface behind one switch. The bottom edge over the pinned
`FooterBar` has the same problem and should get the same treatment.

## Cannot be done without hardware

- **Push delivery itself.** Simulators cannot receive APNs. `registerForPush` returns
  `'unsupported'` on a simulator deliberately, so this genuinely needs a physical device plus an
  EAS project id.
- Airplane-mode matrix (task 54) and the UPI picker — unchanged.

## To deploy the dispatcher (nothing committed contains these)

```
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'chukta_functions_url');
select vault.create_secret('<service key>', 'chukta_service_key');
supabase functions deploy push-dispatch
```

Until both secrets exist, every cron job no-ops silently by design — verified: 11 dispatch runs
on an unconfigured database, all succeeded.

## Local gotcha that cost time tonight

`ALTER TABLE` on `internal.notification_queue` **deadlocks against the running cron job**. Run
`update cron.job set active = false;` before applying migrations by hand, or just use
`npx supabase db reset`. Also: `cron.job_run_details` keys on `jobid`, not `jobname` — join to
`cron.job` to read outcomes.

---

# 🐞 "Someone" on the expense form — DIAGNOSED, not yet fixed (2026-07-26)

**Reported:** *"When I create a new person and make an expense with them for the first time, I
can see an extra person in the splitting called Someone. It's me, them and someone always."*

**Not a server bug.** The database is correct: two placeholders, both owned by the reporter,
both with their real names, and `internal.mutation_log` shows two clean
`upsert_contact_profile` calls that returned the client-supplied ids. `expenses` and
`groups` are empty — this is happening on the form, before anything is saved. `Someone` here
is the client-side fallback at `apps/mobile/src/app/(app)/expense/new.tsx:110`, **not** the
`display_name` the signup trigger writes (`0013:57`). Nothing in `public.profiles` is named
`Someone`.

## The cause — a race that is lost by ~850ms, every time

`AddPersonSheet.create()` (`features/people/AddPersonSheet.tsx:109-111`) does three things in
this order, and the order is the bug:

```ts
offline.refresh();
offline.sync();                                                   // deferred 900ms
void queryClient.invalidateQueries({ queryKey: queryKeys.home() }); // fires NOW
```

1. `t=0` — the person is a row in the outbox. `pendingPeople` has them, so the picker shows
   them and `new.tsx` can name them. Correct so far.
2. `t=0` — `invalidateQueries(home)` refetches immediately, because the picker is holding an
   active observer of that key.
3. `t≈50ms` — **the server answers without the new person, because the server has not been
   told yet.** That answer is written into the cache and marked fresh for `staleTime: 60_000`
   (`app/_layout.tsx:28`).
4. `t=900ms` — `sync` is deliberately deferred by `SYNC_AFTER_TRANSITION_MS =
   motion.ripple.duration` (`OfflineProvider.tsx:89`) so the drain does not land on the
   ripple's opening frames. Only now does the drain create the profile server-side and
   **delete the outbox row** — which removes them from `pendingPeople`.

From `t≈900ms` the person is in **neither** source for up to a minute:

| source | has them? | why not |
|---|---|---|
| `homeQuery.data.people` | no | refetched at step 3, before the server knew |
| `offline.pendingPeople` | no | the outbox row was deleted when the drain succeeded |

`new.tsx:110` falls through `person?.display_name ?? queued?.displayName ?? 'Someone'` to the
literal. Navigating to the form does not rescue it — the home data is <60s old, so mounting a
second observer refetches nothing.

**Nothing closes the hole afterwards.** `upsert_contact_profile` never calls
`internal.emit_change` (read `0024:51-140` — there is no emit anywhere in it), so `sync_pull`
carries no event for it and the realtime path never invalidates `queryKeys.home()`. The only
invalidation that ever fires for this write is the one at step 2, which is guaranteed to be
too early. `offline.refresh()` bumps the SQLite-derived `version`, not react-query.

This is the same failure migration `0022` fixed for the online case, arriving through a new
door — and the header comment on `lib/offline/people.ts` already warns about exactly this
shape: *a person you have created who does not appear anywhere is not a person you can split
anything with.*

## Why there are three rows and not two

The name hole above explains `Someone`; it does not explain the count. That is a second,
independent defect in the picker:

`who.tsx:69-74` — `onPersonAdded` **appends and never replaces**, and the sheet can be
reopened. Add "Harshi Kadali", notice the typo, add "Harshi Kadalo" — and both are ticked.
The footer only says "2 people", the wrong one is never shown as removable, and the first
mistake rides all the way onto the expense.

The DB corroborates this: two placeholders with near-identical names, created 19 seconds
apart (`09:49:56` and `09:50:15`). It also explains why one name resolves and one does not —
the second `create()`'s refetch returned a roster that already contained the first person
(drained 19s earlier) but not the second. Hence exactly *"me, them, and Someone"*.

The count half is inferred from the DB state rather than reproduced on device; the name half
is proven from the code path and the empty `expenses` table.

## The fix, when it is scheduled

Three parts, smallest first. **Do part 1 even if the others are deferred** — it is the one
that produces a nameless stranger on a money screen.

1. **Do not refetch a roster the server cannot answer yet.** Drop the eager
   `invalidateQueries(home)` from `AddPersonSheet.create()`; it can only ever return a list
   that predates the write. Invalidate `queryKeys.home()` **after** the drain reports the row
   sent instead — the drainer already has an `onChange` hook (`drain.ts`, `complete(row.id)`).
   The cleanest seam is for `runSync` to invalidate the keys touched by the ops it drained,
   which also fixes this class of bug for every future write that emits no change event.
2. **Belt and braces on the form.** Keep a name for an id once one has been seen, so a roster
   that momentarily forgets somebody cannot rename them mid-form. `Someone` should be
   unreachable for an id the user themselves just typed a name for.
3. **Let the picker take a person back off.** `onPersonAdded` should surface what is selected
   with a way to untick it — a correction should replace a mistake, not accompany it.

**Verify by:** add a person from the picker, tap Continue within ten seconds, and confirm the
form names them. Then repeat with airplane mode on (the drain never runs, `pendingPeople`
keeps them — this path already works and must keep working). Then add two people, untick one,
confirm only one reaches the split.

**Priority: ahead of the remaining Phase 9 items.** It is on the app's primary path — name a
friend, split something with them — it is 100% reproducible, and it is visible on the screen
where the money is decided.

---

# 🚀 DEFINITION OF DONE FOR THE BETA (2026-07-26)

**Decision: the Android beta ships only when everything is finished.** It is a dress rehearsal
for the real release, not a preview — its job is to catch last-minute errors, which it can only
do if it is the actual thing. So nothing on this list is deferred "until after beta".

Target: release the following weekend. Apple developer enrolment is applied for and awaiting
approval; iOS beta starts when it lands. Android is not blocked on that.

## Code — done

| | |
|---|---|
| Phases 0–9 | ✅ built and green: 33 migrations, 187 pgTAP, 159 TS tests |
| Task 69 — nameless participant | ✅ `bf9e4d3` |
| Task 70 — edge blur vignette | ✅ `ce2e709` (aesthetic pass still wanted, see below) |

## Blocking the beta

| # | Item | Needs |
|---|---|---|
| 71 | Push migrations 0025–0033 to the hosted project, deploy the Edge Function, set the two Vault secrets | **DB password** |
| 72 | Rotate the compromised keys (open item #11) | **User, in dashboards** |
| 73 | Real Play upload keystore + SHA-1 registered with Google | **User** (Google Cloud console) |
| 74 | Publish Terms/Privacy to public URLs; add `PrivacyInfo.xcprivacy`; Play data-safety entry | domain or GitHub Pages |
| 75 | Verify the whole app on Android hardware | **A physical Android phone** |
| 54 | Airplane-mode matrix | same phone |
| — | Phase 10 remainder: a11y pass, Android blur perf | nothing — can proceed |
| — | Deep-link domain for invite links (Universal Links / App Links) | **a domain** |

## The one that will actually bite

**`.env` points at the hosted project; `.env.local` overrides it with a LAN address and blank
Google client ids.** Expo loads `.env.local` last, so any build made without moving it aside
ships pointing at a laptop. The APK script in `scratchpad/apk.sh` moves it and restores it in a
`trap` — and note the trap must use ABSOLUTE paths, because the script `cd`s into `android/`
before Gradle runs and a relative restore silently fails, leaving `.env.local` deleted.

## Known and deliberately not fixed

**A sub-second flicker to "Someone".** Between the outbox row being deleted and the roster
refetch landing, a just-named person is briefly in neither source. The 60-second version of this
is fixed (`bf9e4d3`); the residual is a few hundred milliseconds and self-correcting. Two React
Compiler lint rules rejected both implementations of a name cache that would have covered it
(ref written during render; setState synchronously in an effect), and on re-reading, the
ordering fix already closes the window it was guarding. Recorded rather than papered over.

**The vignette has not been judged against text scrolling under it.** It renders, and a tap
inside its band still reaches the control beneath it, so `pointerEvents` is right. But no seeded
screen is tall enough to scroll, so the ramp (`vignette` in `design/tokens.ts` — layers,
intensity, curve, softness) has not been tuned by eye. Do that on a long screen before the beta.

## Local gotchas found today

- `pod install` fails with `Unicode Normalization not appropriate for ASCII-8BIT` unless the
  shell has a UTF-8 locale: `LANG=en_US.UTF-8 pod install`.
- Gradle needs `ANDROID_HOME` exported; it is set in the interactive shell but not in a
  non-interactive one. `export ANDROID_HOME="$HOME/Library/Android/sdk"`.
- `supabase db reset` wipes `auth.users`, and `seed.sql` attaches its fixtures to the most
  recently created profile — so stray `dev-*@chukta.test` accounts from the "New account" button
  steal the seed. Delete them first: `delete from auth.users where email like 'dev-%@chukta.test';`
- The dev sign-in row on the sign-in screen used to sit exactly under LogBox's warning banner,
  which made it untappable. Moved above the footnote in `ce2e709`.

---

## Dev-loop gotchas found on 2026-07-26 (worth reading before debugging "no data")

**A deleted account stays signed in.** Supabase JWTs are stateless, so
`delete from auth.users` does NOT invalidate a token the app already holds. The app stays on
Home as a user that no longer exists, every RPC returns empty, and it looks exactly like a
broken query — the database plainly has three groups and the app shows "No groups yet". Cost
about forty minutes before I read `Documents/mmkv/chukta-auth` and found it authenticated as a
`dev-*` account I had deleted twenty minutes earlier.

```bash
C=$(xcrun simctl get_app_container <UDID> com.chukta.app data)
strings "$C/Documents/mmkv/chukta-auth" | grep -oE '[a-z0-9.-]+@chukta\.test' | head -1
```

**Worth a product decision before beta:** the app has no handling for "my session is valid but
my profile is gone". It renders an empty shell rather than returning to sign-in. `delete_account`
anonymises rather than hard-deletes, so this is mostly a dev-only shape today — but a client
that treats "signed in with no resolvable profile" as signed-out would be more honest, and it is
a small change in `SessionProvider`.

**The seed used to attach to whichever profile was created first**, which is fine until the
sign-in screen's "New account" button mints a `dev-<random>` one. Fixed: `seed.sql` now targets
`dev@chukta.test` by address — the same account `devSignIn` uses — so the seeded account and the
account the button logs into are the same thing by construction rather than by luck.

**Synthetic taps on the sign-in screen's dev row stopped registering** late in the session
(no request reaches `supabase_auth_chukta`, and the same is true for the Kitchen sink link
beside it), while taps everywhere else in the app work. Not diagnosed. It only affects the
automated loop, not a human tapping the screen.

---

# PHASE A — development completeness (2026-07-26)

Everything below is committed and pushed. Gate is green throughout: **206 pgTAP · typecheck ·
lint · 166 TS tests.**

## Done

| # | Item | Commit |
|---|---|---|
| — | **Rename Hisaab → Chukta**, everything: bundle id `com.chukta.app`, npm scope, storage ids, cron/Vault names, Supabase project id, GitHub repo, folder | `cb014b5` `704217f` |
| A1 | **Undo delete.** `restore_expense` was a public RPC nothing called, so deleting was one-way from the UI | `f369801` |
| A2 | **Group settings** — rename, members, add, remove, leave (migrations `0034`, `0035`) | `c19d6cc` `020c9af` |
| A3 | **Legal links** pointed at `example.com` — the consent copy at sign-up linked nowhere | `f369801` |
| A4 | **`/_dev/kitchen-sink`** was an unauthenticated route in a shipped bundle | `f369801` |
| A5 | **`ios.usesAppleSignIn`** — entitlement lived only in gitignored `ios/` | `cb014b5` |
| A6 | **Accessibility** — contrast, Dynamic Type, spoken amounts, labels, touch targets | `d479a6f` `0ef2a8b` `8d78c39` |
| A7 | **Sentry**, behind a DSN seam, with PII scrubbing | `79c0f16` |
| A8 | Tip-jar copy that would have become false at launch | `f369801` |
| A12 | **`merge_profiles` is now reversible** (migration `0036`) | `d7e5a10` |

Plus, from using it: the stuck toast, the `expo-notifications` keychain noise, the About seal,
the split-pill divider, and naming a group moving from a field to a question beside the name.

## Left in Phase A

- **A10 — tune the edge vignette.** Built and safe (`ce2e709`), never judged against text
  actually scrolling under it. Settings or Help is now long enough to test on.
- **A13 — stale docs.** `plan/phase-11-store-release.md:54` still claims there is no Contacts
  permission; there is (`app.config.ts`), and both the Play Data Safety form and the iOS privacy
  manifest must declare it. A false store declaration is the risk, not tidiness.
- **A11 — `EXPO_PUBLIC_STORE_URL`** waits on store listings existing.

## Worth knowing before the next stretch

**Four of the fourteen reported Phase A items were not real**, and each was checked before any
code was written: A9's "missing error path" in Settings (it has three), reduce-motion (all four
animated components already honour it), and three of the eight "unlabelled" controls (a naive
regex mistook `=>` inside a prop for the end of the tag).

**The bugs that were real were mostly found by running the app, not reading it** — the `Someone`
race, the stuck toast, the ambiguous `get_group_detail` overload I introduced myself, the
stale-JWT empty shell. That was the lesson recorded after Phase 8 and it has held every time
since.

**One thing I introduced and caught:** `0035` first typed `p_before` as `timestamptz` where
`0014` declares `date`. Different signature, so `create or replace` added a second overload
instead of replacing, and every call failed with "function is not unique". On screen it looked
like a missing owner badge. Changing a parameter type in a create-or-replace is an ADD, never
an edit.
