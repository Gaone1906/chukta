# Hisaab — build progress

Single place to answer "where are we". Update the status table and the log at the end of
every phase. Each phase has its own file in this directory with the detailed work list.

**Last updated:** 2026-07-25 (Phase 1)

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
| 1 | Design system & motion | [phase-01-design-system.md](phase-01-design-system.md) | ✅ done (Android verified; iOS pending toolchain) | 1 wk |
| 2 | `packages/core` money engine | [phase-02-core-money.md](phase-02-core-money.md) | ⬜ not started (money + formatting landed early) | 0.5 wk |
| 3 | Supabase backend | [phase-03-backend.md](phase-03-backend.md) | ⬜ not started | 2 wk |
| 4 | Auth & onboarding | [phase-04-auth-onboarding.md](phase-04-auth-onboarding.md) | ⬜ not started | 1 wk |
| 5 | Core loop | [phase-05-core-loop.md](phase-05-core-loop.md) | ⬜ not started | 3 wk |
| 6 | Settle up & UPI | [phase-06-settle-upi.md](phase-06-settle-upi.md) | ⬜ not started | 1 wk |
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

---

## Open questions

| # | Question | Blocks | Status |
|---|---|---|---|
| 1 | Store display name — "Hisaab" is taken. Bundle id settled: `com.hisaab.app` | Phase 11 | name open |
| 2 | Currency: Help FAQ says one per group, feature spec says per-expense override. Schema implements per-expense. | Phase 3 | open |
| 3 | Domain for Universal Links / App Links (invite deep links) | Phase 7 | open |
| 4 | Sentry for crash reporting — assumed yes | Phase 10 | assumed |
| 7 | **Android blur** defaults to the opaque fallback — a `BlurView` sampling a `BlurTargetView` SIGSEGVs the emulator's software GPU. Needs a physical device to confirm and flip. | Phase 10 | open |
| 8 | Whole iOS side is unrun — no Xcode on this machine yet. The Liquid Glass branch is written from the API contract, not tested. | Phase 4 | open |
| 5 | Apple Developer Program + Google Play enrolment | Phase 4 / 11 | user will do |
| 6 | Legal review of `legal/terms.md` + `legal/privacy.md` before submission | Phase 11 | drafted, unreviewed |

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
